import type { State, Storage } from './libraryClient.ts';
import { atlasDatabaseName } from './config.ts';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(atlasDatabaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('accounts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Seenary tabs to upgrade local storage.'));
  });
}
export function browserStorage(namespace: string): Storage {
  async function transaction(key: string, state?: State): Promise<State | undefined> {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('accounts', state ? 'readwrite' : 'readonly');
        const store = tx.objectStore('accounts');
        const request = state ? store.put(state, `${namespace}:${key}`) : store.get(`${namespace}:${key}`);
        tx.oncomplete = () => resolve(state ?? request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Local save aborted.'));
      });
    } finally { db.close(); }
  }
  async function remove(key: string) {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('accounts', 'readwrite');
        tx.objectStore('accounts').delete(`${namespace}:${key}`);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Local account cleanup was interrupted.'));
      });
    } finally { db.close(); }
  }
  return { read: key => transaction(key), write: async (key, state) => { await transaction(key, state); }, remove };
}

export async function accountLock<T>(namespace: string, userId: string, task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('This browser needs Web Locks support to save safely.');
  return await navigator.locks.request(`seenary-cloud:${namespace}:${userId}`, task);
}
