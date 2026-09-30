/**
 * Seletores das páginas automatizadas. Os sites mudam com frequência; qualquer chave abaixo
 * pode ser sobrescrita em Configurações → "Seletores avançados" sem mexer no código.
 */
export const DEFAULT_SELECTORS = {
  // ChatGPT
  'chatgpt.composer': '#prompt-textarea, div[contenteditable="true"].ProseMirror, textarea[name="prompt-textarea"]',
  'chatgpt.sendButton': 'button[data-testid="send-button"], button#composer-submit-button',
  'chatgpt.stopButton': 'button[data-testid="stop-button"]',
  'chatgpt.turn': 'article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]',
  'chatgpt.assistantMessage': '[data-message-author-role="assistant"]',
  'chatgpt.userMessage': '[data-message-author-role="user"]',
  'chatgpt.loginButton': 'button[data-testid="login-button"], a[href*="auth/login"], button:has-text("Log in"), button:has-text("Entrar")',

  // Adobe Stock (site público — pesquisa)
  'adobe.searchResultLink': 'a[href*="/images/"]',

  // Adobe Stock Contributor (envio)
  'contributor.fileInput': 'input[type="file"]:not([accept*="csv"])',
  'contributor.csvInput': 'input[type="file"][accept*="csv"]',
  'contributor.loginHint': 'button:has-text("Sign in"), button:has-text("Fazer login"), a:has-text("Sign in")',
} as const;

export type SelectorKey = keyof typeof DEFAULT_SELECTORS;

export function selectors(overrides: Record<string, string>) {
  return (key: SelectorKey): string => overrides[key] || DEFAULT_SELECTORS[key];
}

/** Textos de botões usados no portal do colaborador (inglês e português). */
export const CONTRIBUTOR_TEXT = {
  upload: /^\s*(upload|enviar|carregar)\s*$/i,
  browse: /(browse|procurar|selecionar arquivos|select files|escolher)/i,
  uploadCsv: /(upload csv|carregar csv|enviar csv|csv)/i,
  csvConfirm: /^\s*(upload|enviar|carregar)\s*$/i,
  selectAll: /(select all|selecionar tudo|selecionar todos)/i,
  generativeAi: /(generative ai|ia generativa|inteligência artificial generativa)/i,
  fictional: /(fictional|fictíci)/i,
  saveWork: /(save work|salvar trabalho|salvar)/i,
  submit: /(submit\s*\d*\s*(files?)?|enviar\s*\d*\s*(arquivos?)?)/i,
  uploadDone: /(upload(ed)?\s+(complete|successful|succeeded)|uploads? complete|carregad[oa]s? com sucesso|envio conclu[ií]do|upload conclu[ií]do)/i,
  submitLimit: /(submission limit|weekly limit|reached (your|the) (weekly )?limit|limite (semanal|de envio)|atingiu o limite)/i,
  csvDone: /(csv.*(processed|uploaded|success)|metadata.*(applied|updated)|processad|metadados atualizados|sucesso)/i,
} as const;
