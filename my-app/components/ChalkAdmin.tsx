"use client";
import { useState } from 'react';
import Link from 'next/link';
export default function ChalkAdmin() {
    const [token, setToken] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
    async function act(action: string) { if (action !== 'rotate' && !confirm(action === 'withdraw' ? '撤回公開月曆，並撤銷手機連線？手機記錄會保留。' : '撤銷手機同步權限？現有公開月曆會保留。'))
        return; if (action === 'rotate' && !confirm('產生新手機連線碼？舊碼會即時失效；現有月曆會保留。'))
        return; setBusy(true); setToken(''); try {
        const r = await fetch('/api/chalk-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
        if (!r.ok)
            throw Error();
        const d = await r.json();
        setToken(d.token || '');
        setMessage(action === 'rotate' ? '新碼只顯示今次，請貼入 App 嘅「公開同步」。' : '設定已更新。');
    }
    catch {
        setMessage('未能更新；請確認已用擁有人帳戶登入，稍後再試。');
    }
    finally {
        setBusy(false);
    } }
    return <main lang="zh-Hant" style={{ maxWidth: 680, margin: '40px auto', padding: 24 }}><Link href="/chalk-days">← 公開月曆</Link><h1 style={{ fontSize: 28, margin: '24px 0' }}>粉筆日子 · 手機連線</h1><p>只公開習慣名同手繪記錄；筆記留喺手機。每次只准一部手機寫入。</p><p style={{ margin: '16px 0' }}>1. 產生連線碼　2. 喺 App 右上角撳「同步」　3. 貼上連線碼並儲存　4. 撳「公開最新記錄」</p><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{[['rotate', '產生／更換連線碼'], ['revoke', '撤銷手機權限'], ['withdraw', '撤回公開月曆']].map(([a, label]) => <button style={{ border: '1px solid #b8a584', padding: '8px 14px', borderRadius: 12 }} key={a} disabled={busy} onClick={() => void act(a)}>{label}</button>)}</div><p role="status" style={{ marginTop: 16 }}>{message}</p>{token && <div><label htmlFor="phone-key">手機連線碼（只交俾自己）</label><textarea id="phone-key" readOnly value={token} rows={3} style={{ display: 'block', width: '100%', margin: '12px 0', padding: 12, border: '1px solid #b8a584' }}/><button onClick={async () => { try {
        await navigator.clipboard.writeText(token);
        setMessage('已複製連線碼。');
    }
    catch {
        setMessage('請長按連線碼手動複製。');
    } }}>複製連線碼</button></div>}</main>;
}
