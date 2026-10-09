import { NextResponse } from 'next/server';
import { runApi } from '../../../lib/backend.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request) {
  try {
    const result = await runApi('/api/session', request);
    return NextResponse.json(result?.body ?? {ok:false,error:'Пустой ответ API.'}, {status: Number(result?.status || 500), headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    return NextResponse.json({ok:false,error:String(error?.message || error || 'Ошибка API')},{status:500,headers:{'Cache-Control':'no-store'}});
  }
}
export const GET = handle;
export const POST = handle;
