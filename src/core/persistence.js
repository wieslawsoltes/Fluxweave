import { validateProject } from './graph.js';
const DB_NAME = 'fluxweave-projects';
function openDB() {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('projects');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}
export async function saveLocal(project) {
    const db = await openDB();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction('projects', 'readwrite');
            tx.objectStore('projects').put(structuredClone(project), 'autosave');
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Save aborted'));
        });
    }
    finally {
        db.close();
    }
}
export async function loadLocal() {
    const db = await openDB();
    try {
        return await new Promise((resolve, reject) => {
            const req = db.transaction('projects').objectStore('projects').get('autosave');
            req.onsuccess = () => {
                try {
                    resolve(req.result ? validateProject(req.result) : null);
                }
                catch (e) {
                    reject(e);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }
    finally {
        db.close();
    }
}
export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function exportProject(project) {
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `${project.name.replace(/[^\w\- ]/g, '') || 'network'}.flux`);
}
export async function importProject(file) {
    if (file.size > 100 * 1024 * 1024)
        throw new Error('Project file exceeds the 100 MB import limit.');
    return validateProject(JSON.parse(await file.text()));
}
export function fileDataURL(file) {
    if (file.size > 64 * 1024 * 1024)
        throw new Error('Embedded media is limited to 64 MB per asset.');
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
