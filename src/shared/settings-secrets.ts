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
