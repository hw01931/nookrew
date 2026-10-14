// Only the public, validated configuration is embedded by the server.
export let settings;
export function configure(value) {
  if (value?.schemaVersion !== 1) throw Error('UNSUPPORTED_UI_CONFIG');
  settings = value;
}
