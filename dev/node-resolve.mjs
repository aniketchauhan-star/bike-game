const root = new URL('../', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: new URL('vendor/three/three.module.js', root).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: new URL('vendor/three/addons/' + specifier.slice(13), root).href, shortCircuit: true };
  return next(specifier, context);
}
