import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const stub=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/auth',()=>({getCurrentUser:stub.user,isAdmin:(u:{app_metadata?:{role?:string}}|null)=>u?.app_metadata?.role==='admin'}));
vi.mock('@/lib/supabase/server',()=>({createServiceClient:()=>({rpc:stub.rpc})}));
import { POST } from '@/app/api/chalk-admin/route';
const request=(action='rotate',origin='https://pingu.test')=>new Request('https://pingu.test/api/chalk-admin',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action})});
beforeEach(()=>{vi.clearAllMocks();stub.user.mockResolvedValue({id:'owner-id',app_metadata:{role:'admin'}});stub.rpc.mockResolvedValue({data:{status:200},error:null});});
describe('verified owner administration',()=>{
 it('rejects cross origin before auth or storage',async()=>{expect((await POST(request('rotate','https://other.test'))).status).toBe(403);expect(stub.user).not.toHaveBeenCalled();expect(stub.rpc).not.toHaveBeenCalled();});
 it('rejects anonymous and non-admin sessions',async()=>{for(const u of [null,{id:'visitor'}]){stub.user.mockResolvedValue(u);expect((await POST(request())).status).toBe(401);}expect(stub.rpc).not.toHaveBeenCalled();});
 it('does not hand out a token when database rejects owner',async()=>{stub.rpc.mockResolvedValue({data:{status:403},error:null});const res=await POST(request());expect(res.status).toBe(403);expect(await res.json()).not.toHaveProperty('token');});
 it('returns one random key and stores only its digest tied to verified owner',async()=>{const res=await POST(request());const body=await res.json();expect(body.token).toMatch(/^[a-f0-9]{64}$/);expect(stub.rpc).toHaveBeenCalledWith('chalk_admin',{p_owner:'owner-id',p_action:'rotate',p_key_hash:createHash('sha256').update(body.token).digest('hex')});expect(res.headers.get('cache-control')).toBe('no-store');});
 it('revocation never mints a new token',async()=>{expect(await (await POST(request('revoke'))).json()).toEqual({ok:true});expect(stub.rpc).toHaveBeenCalledWith('chalk_admin',{p_owner:'owner-id',p_action:'revoke',p_key_hash:null});});
 it('sanitizes database errors',async()=>{stub.rpc.mockResolvedValue({error:{message:'private diagnostic'}});const res=await POST(request());expect(res.status).toBe(503);expect(await res.text()).not.toContain('private diagnostic');});
});

it('uses the external destination host and protocol when Next normalizes req.url',async()=>{
 const req=new Request('http://localhost:3000/api/chalk-admin',{method:'POST',headers:{Host:'pingu.test','X-Forwarded-Proto':'https',Origin:'https://pingu.test','Content-Type':'application/json'},body:'{"action":"rotate"}'});
 expect((await POST(req)).status).toBe(200);
});
it('does not trust a caller-supplied forwarded host',async()=>{
 const req=new Request('http://localhost:3000/api/chalk-admin',{method:'POST',headers:{Host:'pingu.test','X-Forwarded-Host':'other.test','X-Forwarded-Proto':'https',Origin:'https://other.test','Content-Type':'application/json'},body:'{"action":"rotate"}'});
 expect((await POST(req)).status).toBe(403);expect(stub.rpc).not.toHaveBeenCalled();
});
