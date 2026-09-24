-- Dedicated singleton calendar. No existing tables/rows are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.chalk_calendar (
 id integer PRIMARY KEY CHECK (id=1), owner_id uuid NOT NULL REFERENCES auth.users(id),
 key_hash text, device_id text, revision bigint NOT NULL DEFAULT -1,
 payload_hash text, payload jsonb NOT NULL DEFAULT '{"schema":1,"year":2026,"habits":[],"rows":[]}'::jsonb,
 published boolean NOT NULL DEFAULT false, accepted_at timestamptz
);
ALTER TABLE public.chalk_calendar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chalk_calendar FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.chalk_calendar TO service_role;
DO $owner$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.chalk_calendar WHERE id=1) THEN
  IF (SELECT count(*) FROM auth.users WHERE raw_app_meta_data->>'role'='admin') <> 1 THEN
   RAISE EXCEPTION 'Calendar owner requires exactly one existing admin';
  END IF;
  INSERT INTO public.chalk_calendar(id,owner_id) SELECT 1,id FROM auth.users WHERE raw_app_meta_data->>'role'='admin';
 END IF;
END $owner$;
CREATE OR REPLACE FUNCTION public.chalk_publish(p_key_hash text,p_snapshot jsonb,p_payload_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE r public.chalk_calendar%ROWTYPE; v bigint;
BEGIN
 SELECT * INTO r FROM public.chalk_calendar WHERE id=1 FOR UPDATE;
 IF r.key_hash IS NULL OR p_key_hash IS DISTINCT FROM r.key_hash THEN RETURN jsonb_build_object('status',401); END IF;
 IF COALESCE(p_snapshot->>'schema','') NOT IN ('1','2') OR p_snapshot->>'year'<>'2026' OR p_snapshot ? 'notes' OR jsonb_typeof(p_snapshot->'published')<>'boolean' OR jsonb_typeof(p_snapshot->'habits')<>'array' OR jsonb_typeof(p_snapshot->'rows')<>'array' THEN RETURN jsonb_build_object('status',400); END IF;
 v=(p_snapshot->>'revision')::bigint;
 IF v IS NULL OR v<0 OR v>9007199254740991 OR p_snapshot->>'device_id' IS NULL THEN RETURN jsonb_build_object('status',400); END IF;
 IF r.device_id IS NOT NULL AND r.device_id IS DISTINCT FROM p_snapshot->>'device_id' THEN RETURN jsonb_build_object('status',409); END IF;
 IF v<r.revision OR (v=r.revision AND p_payload_hash IS DISTINCT FROM r.payload_hash) THEN RETURN jsonb_build_object('status',409); END IF;
 IF v>r.revision THEN
  UPDATE public.chalk_calendar SET device_id=p_snapshot->>'device_id',revision=v,payload=p_snapshot,payload_hash=p_payload_hash,published=(p_snapshot->>'published')::boolean,accepted_at=clock_timestamp() WHERE id=1 RETURNING * INTO r;
 END IF;
 RETURN jsonb_build_object('status',200,'revision',r.revision,'accepted_at',r.accepted_at,'published',r.published);
END $fn$;
CREATE OR REPLACE FUNCTION public.chalk_admin(p_owner uuid,p_action text,p_key_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE r public.chalk_calendar%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.chalk_calendar WHERE id=1 FOR UPDATE;
 IF r.owner_id IS DISTINCT FROM p_owner THEN RETURN jsonb_build_object('status',403); END IF;
 IF p_action='rotate' AND p_key_hash ~ '^[a-f0-9]{64}$' THEN
  UPDATE public.chalk_calendar SET key_hash=p_key_hash,device_id=NULL,revision=-1,payload_hash=NULL WHERE id=1;
 ELSIF p_action='revoke' THEN UPDATE public.chalk_calendar SET key_hash=NULL WHERE id=1;
 ELSIF p_action='withdraw' THEN
  -- Also revoke: an already in-flight request cannot republish after withdrawal.
  UPDATE public.chalk_calendar SET published=false,key_hash=NULL,payload='{"schema":1,"year":2026,"habits":[],"rows":[]}'::jsonb,accepted_at=clock_timestamp() WHERE id=1;
 ELSE RETURN jsonb_build_object('status',400);
 END IF;
 RETURN jsonb_build_object('status',200);
END $fn$;
REVOKE ALL ON FUNCTION public.chalk_publish(text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.chalk_admin(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chalk_publish(text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.chalk_admin(uuid,text,text) TO service_role;
COMMIT;
