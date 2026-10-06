/** Address lookup by Brazilian CEP via the free ViaCEP API (no key, BR only). */

export interface CepAddress {
  street: string
  neighborhood: string
  city: string
  state: string
}

/** Returns the address for an 8-digit CEP, or null when invalid / not found. */
export async function lookupCep(cep: string): Promise<CepAddress | null> {
  const digits = cep.replace(/\D/g, '')
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const data = await res.json()
    if (data.erro) return null
    return {
      street: data.logradouro ?? '',
      neighborhood: data.bairro ?? '',
      city: data.localidade ?? '',
      state: data.uf ?? ''
    }
  } catch {
    return null
  }
}

/** CEP nos Correios (ViaCEP): o endereço, "nao_existe", ou null se a consulta falhou (rede, ViaCEP fora). */
export async function consultarCep(cep: string): Promise<CepAddress | "nao_existe" | null> {
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 400) return "nao_existe";
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, string | boolean>;
    if (d.erro) return "nao_existe";
    return { street: String(d.logradouro ?? ""), neighborhood: String(d.bairro ?? ""), city: String(d.localidade ?? ""), state: String(d.uf ?? "") };
  } catch {
    return null;
  }
}
