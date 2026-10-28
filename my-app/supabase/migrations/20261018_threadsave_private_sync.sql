-- Private metadata/text only. Existing Chalk Days and other tables are untouched.
BEGIN;
CREATE TABLE IF NOT EXISTS public.threadsave_archive (
 id integer PRIMARY KEY CHECK (id=1), owner_id uuid NOT NULL REFERENCES auth.users(id),
 key_hash text, device_id text, revision bigint NOT NULL DEFAULT -1,
 payload_hash text, payload jsonb, accepted_at timestamptz
);
ALTER TABLE public.threadsave_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.threadsave_archive FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.threadsave_archive TO service_role;
DO $owner$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.threadsave_archive WHERE id=1) THEN
  IF (SELECT count(*) FROM auth.users WHERE raw_app_meta_data->>'role'='admin') <> 1 THEN RAISE EXCEPTION 'Threadsave requires exactly one existing admin'; END IF;
  INSERT INTO public.threadsave_archive(id,owner_id) SELECT 1,id FROM auth.users WHERE raw_app_meta_data->>'role'='admin';
 END IF;
END $owner$;
CREATE OR REPLACE FUNCTION public.threadsave_publish(p_key_hash text,p_snapshot jsonb,p_payload_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE r public.threadsave_archive%ROWTYPE; v bigint;
BEGIN
 SELECT * INTO r FROM public.threadsave_archive WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR r.key_hash IS NULL OR p_key_hash IS DISTINCT FROM r.key_hash THEN RETURN jsonb_build_object('status',401); END IF;
 IF p_snapshot->>'schema' IS DISTINCT FROM '1' OR jsonb_typeof(p_snapshot->'categories') IS DISTINCT FROM 'array' OR jsonb_typeof(p_snapshot->'archives') IS DISTINCT FROM 'array'
 OR COALESCE(p_snapshot->>'device_id','') !~ '^[A-Za-z0-9_-]{1,64}$' OR COALESCE(p_snapshot->>'revision','') !~ '^[0-9]{1,16}$'
 OR COALESCE(p_payload_hash,'') !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('status',400); END IF;
 v=(p_snapshot->>'revision')::bigint;
 IF v<1 OR v>9007199254740991 THEN RETURN jsonb_build_object('status',400); END IF;
 IF r.device_id IS NOT NULL AND r.device_id IS DISTINCT FROM p_snapshot->>'device_id' THEN RETURN jsonb_build_object('status',409); END IF;
 IF v<r.revision OR (v=r.revision AND p_payload_hash IS DISTINCT FROM r.payload_hash) THEN RETURN jsonb_build_object('status',409); END IF;
 IF v>r.revision THEN
  UPDATE public.threadsave_archive SET device_id=p_snapshot->>'device_id',revision=v,payload=p_snapshot,payload_hash=p_payload_hash,accepted_at=clock_timestamp() WHERE id=1 RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('status',200,'revision',r.revision,'accepted_at',r.accepted_at,'payload_hash',r.payload_hash);
END $fn$;
CREATE OR REPLACE FUNCTION public.threadsave_admin(p_owner uuid,p_action text,p_key_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE r public.threadsave_archive%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.threadsave_archive WHERE id=1 FOR UPDATE;
 IF NOT FOUND OR r.owner_id IS DISTINCT FROM p_owner THEN RETURN jsonb_build_object('status',403); END IF;
 IF p_action='rotate' AND COALESCE(p_key_hash,'') ~ '^[a-f0-9]{64}$' THEN
  UPDATE public.threadsave_archive SET key_hash=p_key_hash,device_id=NULL,revision=-1,payload_hash=NULL WHERE id=1;
 ELSIF p_action='revoke' THEN UPDATE public.threadsave_archive SET key_hash=NULL WHERE id=1;
 ELSE RETURN jsonb_build_object('status',400); END IF;
 RETURN jsonb_build_object('status',200);
END $fn$;
REVOKE ALL ON FUNCTION public.threadsave_publish(text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.threadsave_admin(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.threadsave_publish(text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.threadsave_admin(uuid,text,text) TO service_role;
COMMIT;
