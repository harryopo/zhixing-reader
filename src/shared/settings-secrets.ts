/**
 * 需要加密保存的设置项 —— 读、写、迁移三条路都从这里取，免得各说一套。
 *
 * 判据：值本身是别人能拿去调你账号的东西（不是偏好、不是路径）。
 * 所以新增 API 密钥类设置项时，必须同时加进这张表。
 */
export const SECRET_SETTING_KEYS = ['wereadApiKey', 'llmKey'] as const

export type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number]

export function isSecretSetting(key: string): key is SecretSettingKey {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key)
}

/**
 * 渲染层能看到的替身字段名：`wereadApiKey` ⇒ `wereadApiKeySet`。
 *
 * 密钥原值**不出主进程** —— 渲染层只拿到"配没配"这个布尔值，输入框因此是
 * "留空则不修改"的语义，而不是把已存的 key 摊在界面上。
 * 名字只在这里定一次，主进程与界面都从这儿取。
 */
export function secretSetFlagName(key: SecretSettingKey): `${SecretSettingKey}Set` {
  return `${key}Set`
}

/** 所有「配没配」字段名，供守卫测试横扫用 */
export const SECRET_SET_FLAG_NAMES = SECRET_SETTING_KEYS.map(secretSetFlagName) as [
  `${SecretSettingKey}Set`,
  ...`${SecretSettingKey}Set`[],
]

/**
 * 渲染层提交的 AI 配置里，`apiKey` 可以是空的 —— 空表示"沿用已保存的那把"。
 *
 * 界面上不再有 key 原值（只知配没配），所以"只改端点/模型"这类保存必须能在主进程补回 key，
 * 否则 Authorization 头会变成空的。补不到（真没配过）就原样交空串，让调用方照常报"请先配置"。
 */
export function withStoredApiKey(
  config: Record<string, unknown>,
  storedKey: unknown,
): Record<string, unknown> {
  if (typeof config.apiKey === 'string' && config.apiKey.length > 0) return config
  return { ...config, apiKey: typeof storedKey === 'string' ? storedKey : '' }
}
