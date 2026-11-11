import { describe, it, expect } from 'vitest';
import { pt } from './pt';

/** Every string in a nested resource object, with its dotted key. */
function strings(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') return [[path, v] as [string, string]];
    return v && typeof v === 'object' && !Array.isArray(v) ? strings(v as Record<string, unknown>, path) : [];
  });
}

// pt.ts is European Portuguese (Guardar, Utilizador, Palavra-passe). These words are the Brazilian
// forms that had crept into the connector, report and report designer strings.
const BRAZILIAN = /\b(Salvar|salvar|Salvo|salvo|salva|salvas|salvos|Salve|Salvando|Usuário|usuário|Senha|senha|Testando|Excluir|exclui|excluído|Baixar|Planilha|Renderizando|Conectado|organizacionais|registrada|Isso)\b/;

describe('pt.ts is European Portuguese', () => {
  it('uses no Brazilian forms', () => {
    const found = strings(pt as Record<string, unknown>).filter(([, v]) => BRAZILIAN.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(found).toEqual([]);
  });
});
