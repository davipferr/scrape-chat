// Atalhos salvos pelo usuário ("Salvar como atalho" num job): um pedido que ele
// quer repetir com um clique. Ficam em data/shortcuts.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export const SHORTCUTS_FILE = 'data/shortcuts.json';
export const MAX_SAVED = 50;
export const MAX_LABEL = 60;
export const MAX_TEXT = 4000;

export interface SavedShortcut {
  id: string;
  label: string;
  text: string;
  createdAt: string;
}

export class SavedShortcutStore {
  private readonly file: string;
  private items: SavedShortcut[];

  constructor(root: string) {
    this.file = join(root, SHORTCUTS_FILE);
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      this.items = Array.isArray(parsed) ? (parsed as SavedShortcut[]) : [];
    } catch {
      this.items = [];
    }
  }

  list(): SavedShortcut[] {
    return this.items;
  }

  /** Salva um atalho. Lança um erro com mensagem para o usuário se algo não couber. */
  add(label: string, text: string): SavedShortcut {
    const cleanLabel = label.trim().replace(/\s+/g, ' ');
    const cleanText = text.trim();
    if (!cleanLabel) throw new Error('dê um nome ao atalho');
    if (cleanLabel.length > MAX_LABEL) throw new Error(`o nome passa de ${MAX_LABEL} caracteres`);
    if (!cleanText) throw new Error('o atalho precisa de um pedido');
    if (cleanText.length > MAX_TEXT) throw new Error(`o pedido passa de ${MAX_TEXT} caracteres`);
    if (this.items.length >= MAX_SAVED) throw new Error(`já são ${MAX_SAVED} atalhos; apague algum antes`);
    const item: SavedShortcut = { id: randomUUID(), label: cleanLabel, text: cleanText, createdAt: new Date().toISOString() };
    this.items = [item, ...this.items];
    this.save();
    return item;
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    if (this.items.length === before) return false;
    this.save();
    return true;
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.items, null, 2));
  }
}
