import {useEffect,useState} from 'react';
import type {RichDocument} from './domain/rich-document';
export const publicService=(import.meta.env.VITE_PUBLIC_SERVICE_URL??'http://127.0.0.1:4318').replace(/\/$/,'');
export type PublicSession={token:string;user:{id:string;username:string}};
export type PublicPost={id:string;author:string;authorId:string;title:string;body:string;document:RichDocument|null;sourceId:string|null;revision:number;visible:boolean;createdAt:string;updatedAt:string};
function readSession():PublicSession|null{try{return JSON.parse(sessionStorage.getItem('dafeiyu-public-session')??'null');}catch{return null;}}
export function setPublicSession(value:PublicSession|null){if(value)sessionStorage.setItem('dafeiyu-public-session',JSON.stringify(value));else sessionStorage.removeItem('dafeiyu-public-session');window.dispatchEvent(new Event('dafeiyu-public-session'));}
export function usePublicSession(){const [session,setSession]=useState(readSession);useEffect(()=>{const changed=()=>setSession(readSession());window.addEventListener('dafeiyu-public-session',changed);return()=>window.removeEventListener('dafeiyu-public-session',changed);},[]);return session;}
export async function publicRequest<T>(route:string,options:{method?:string;body?:unknown;revision?:number;signal?:AbortSignal}={}):Promise<T>{
  const session=readSession();let response:Response;
  try{response=await fetch(publicService+route,{method:options.method??'GET',body:options.body===undefined?undefined:JSON.stringify(options.body),headers:{...(options.body===undefined?{}:{'Content-Type':'application/json'}),...(session?{Authorization:`Bearer ${session.token}`} :{}),...(options.revision?{'If-Match':String(options.revision)}:{})},signal:options.signal??AbortSignal.timeout(10000)});}catch{throw new Error('本机分享服务未连接，请启动服务后重试。');}
  const data=await response.json();if(!response.ok)throw new Error(data.error??'请求未完成。');return data as T;
}
export function publicationLink(id:string){return `${publicService}/p/${id}`;}
export type PublishedLink={id:string;revision:number;fingerprint:string};
export function readPublishedLink(recordId:string):PublishedLink|null{try{return JSON.parse(localStorage.getItem('dafeiyu-published-links-v1')??'{}')[recordId]??null;}catch{return null;}}
export function rememberPublishedLink(recordId:string,value:PublishedLink|null){try{const links=JSON.parse(localStorage.getItem('dafeiyu-published-links-v1')??'{}');if(value)links[recordId]=value;else delete links[recordId];localStorage.setItem('dafeiyu-published-links-v1',JSON.stringify(links));}catch{/* Published copies remain managed by their author on the service. */}}
export async function contentFingerprint(content:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(content))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
