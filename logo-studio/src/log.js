// Log simples com timestamp. Detalhes de provedor ficam apenas no log do servidor.
const stamp = () => new Date().toISOString();

export const log = {
  info: (...args) => console.log(stamp(), 'INFO ', ...args),
  warn: (...args) => console.warn(stamp(), 'WARN ', ...args),
  error: (...args) => console.error(stamp(), 'ERROR', ...args),
};
