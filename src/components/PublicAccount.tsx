import {useId,useState} from 'react';
import {publicRequest,setPublicSession,usePublicSession} from '../community';
import type {PublicSession} from '../community';
import {useI18n} from '../i18n';
export default function PublicAccount(){
  const {t}=useI18n(),session=usePublicSession(),hintId=useId();const [register,setRegister]=useState(false),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[invalid,setInvalid]=useState<'username'|'password'|null>(null);
  if(session)return <div className="public-account"><span>{t('当前账号：{0}',session.user.username)}</span><button className="text-button" onClick={async()=>{try{await publicRequest('/api/logout',{method:'POST'});}finally{setPublicSession(null);}}}>{t('退出账号')}</button></div>;
  return <form className="public-account-form" noValidate onSubmit={async event=>{
    event.preventDefault();if(busy)return;setError('');setInvalid(null);
    if(!/^[A-Za-z0-9_-]{3,32}$/.test(username)){setInvalid('username');setError('用户名需为 3–32 位字母、数字、下划线或短横线。');event.currentTarget.querySelector<HTMLInputElement>('[name=username]')?.focus();return;}
    if(password.length<8||password.length>128){setInvalid('password');setError('密码需为 8–128 位，请补全后再试。');event.currentTarget.querySelector<HTMLInputElement>('[name=password]')?.focus();return;}
    setBusy(true);try{setPublicSession(await publicRequest<PublicSession>(register?'/api/register':'/api/login',{method:'POST',body:{username,password}}));setPassword('');}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  }}>
    <p>{t('本地记事无需账号，发布时再登录。')}</p><div className="public-account-fields">
      <label>{t('用户名')}<input name="username" aria-label={t('公开账号用户名')} aria-describedby={`${hintId}-username`} aria-invalid={invalid==='username'} value={username} minLength={3} maxLength={32} pattern="[A-Za-z0-9_-]{3,32}" placeholder={t('字母、数字或下划线')} autoComplete="username" disabled={busy} onChange={event=>{setUsername(event.target.value);setInvalid(null);setError('');}} required/><small id={`${hintId}-username`}>{t('3–32 位，可用字母、数字、_ 或 -')}</small></label>
      <label>{t('密码')}<input name="password" aria-label={t('公开账号密码')} aria-describedby={`${hintId}-password`} aria-invalid={invalid==='password'} type="password" value={password} minLength={8} maxLength={128} placeholder={t('至少 8 位')} autoComplete={register?'new-password':'current-password'} disabled={busy} onChange={event=>{setPassword(event.target.value);setInvalid(null);setError('');}} required/><small id={`${hintId}-password`}>{t('8–128 位，至少输入 8 位')}</small></label>
    </div>{error&&<p role="alert">{t(error)}</p>}<div className="dialog-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>{setRegister(!register);setError('');setInvalid(null);}}>{t(register?'已有账号，登录':'创建公开账号')}</button><button className="button primary" disabled={busy}>{t(busy?'正在处理…':register?'注册并登录':'登录')}</button></div>
  </form>;
}
