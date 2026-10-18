import { supabase } from './supabase';

const localKey = (userId: string) => `ae-read-news:${userId}`;

function readLocal(userId: string) {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(localKey(userId)) || '[]'));
  } catch {
    return new Set<string>();
  }
}

function writeLocal(userId: string, keys: Set<string>) {
  localStorage.setItem(localKey(userId), JSON.stringify([...keys]));
}

export async function loadReadNewsKeys(userId: string) {
  const local = readLocal(userId);
  const { data, error } = await supabase
    .from('launcher_news_reads')
    .select('news_key')
    .eq('user_id', userId);

  if (error) return local;
  const synced = new Set<string>([...local, ...(data || []).map((item) => item.news_key as string)]);
  writeLocal(userId, synced);
  return synced;
}

export async function markNewsKeyRead(userId: string, newsKey: string) {
  const local = readLocal(userId);
  local.add(newsKey);
  writeLocal(userId, local);

  const { error } = await supabase
    .from('launcher_news_reads')
    .upsert({ user_id: userId, news_key: newsKey, read_at: new Date().toISOString() }, { onConflict: 'user_id,news_key' });
  if (error && error.code !== '42P01') throw error;
}
