export type RfpVariantData = { gc: 'standard' | 'enhanced'; architect: 'standard' | 'enhanced' };

const DEFAULTS: RfpVariantData = { gc: 'standard', architect: 'standard' };

export function parseRfpVariant(v: string | null | undefined): RfpVariantData {
  if (!v || v === 'standard') return DEFAULTS;
  if (v === 'enhanced') return { gc: 'enhanced', architect: 'enhanced' };
  try {
    const parsed = JSON.parse(v);
    return {
      gc: parsed.gc === 'enhanced' ? 'enhanced' : 'standard',
      architect: parsed.architect === 'enhanced' ? 'enhanced' : 'standard',
    };
  } catch {
    return DEFAULTS;
  }
}
