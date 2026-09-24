-- Expand the existing singleton publisher to accept the installed v1 APK and
-- new refinement-aware v2 snapshots. No table, owner, key, or calendar row is
-- changed by this migration.
BEGIN;
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
REVOKE ALL ON FUNCTION public.chalk_publish(text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chalk_publish(text,jsonb,text) TO service_role;
COMMIT;
