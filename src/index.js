console.log('[portal-runtime] commonComponents loaded')

export const TOKEN_TTL_SECONDS = 2 * 60 * 60
export const TOKEN_REFRESH_WINDOW_SECONDS = 5 * 60

const DEFAULT_CONTENT_TYPE = 'application/json; charset=utf-8'

const currentUnixSeconds = () => Math.floor(Date.now() / 1000)

const normalizeUser = (user = {}) => ({
  userId: user.userId || user.id || 'local-admin',
  account: user.account || 'admin',
  name: user.name || user.userName || '李主任',
  userName: user.userName || user.name || '李主任',
  orgId: user.orgId || user.org_id || 'quality-cloud',
  orgName: user.orgName || user.org_name || '数智医疗质控云平台',
  deptId: user.deptId || user.dept_id || 'quality-office',
  deptName: user.deptName || user.dept_name || '质控中心',
})

const encodeBase64Url = (value) => {
  const json = typeof value === 'string' ? value : JSON.stringify(value)

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64url')
  }

  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const decodeBase64Url = (value) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'base64url').toString('utf8')
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const parseJson = (value, fallback = null) => {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

const joinUrl = (baseUrl = '', path = '') => {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = path.replace(/^\//, '')

  if (normalizedBase === '/api' && normalizedPath.startsWith('api/')) {
    return `/${normalizedPath}`
  }

  if (!normalizedBase) {
    return `/${normalizedPath}`
  }

  if (!normalizedPath) {
    return normalizedBase || '/'
  }

  return `${normalizedBase}/${normalizedPath}`
}

export const createMockToken = (user = {}, nowSeconds = currentUnixSeconds()) => {
  const normalizedUser = normalizeUser(user)
  const header = {
    alg: 'none',
    typ: 'JWT',
  }
  const payload = {
    userId: normalizedUser.userId,
    account: normalizedUser.account,
    name: normalizedUser.name,
    userName: normalizedUser.userName,
    orgId: normalizedUser.orgId,
    orgName: normalizedUser.orgName,
    deptId: normalizedUser.deptId,
    deptName: normalizedUser.deptName,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
    expiresIn: TOKEN_TTL_SECONDS,
  }

  return `${encodeBase64Url(header)}.${encodeBase64Url(payload)}.${encodeBase64Url('mock-signature')}`
}

export const parseToken = (token) => {
  const [, payloadPart] = String(token || '').split('.')
  const payload = parseJson(payloadPart ? decodeBase64Url(payloadPart) : '')

  if (!payload?.exp || !payload?.iat) {
    return null
  }

  const user = normalizeUser(payload)

  return {
    token,
    payload,
    user,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    expiresIn: payload.expiresIn || payload.exp - payload.iat,
  }
}

export const isTokenExpired = (token, nowSeconds = currentUnixSeconds()) => {
  const session = parseToken(token)
  return !session || session.expiresAt <= nowSeconds
}

export const shouldRefreshToken = (
  token,
  nowSeconds = currentUnixSeconds(),
  refreshWindowSeconds = TOKEN_REFRESH_WINDOW_SECONDS,
) => {
  const session = parseToken(token)
  return !session || session.expiresAt - nowSeconds <= refreshWindowSeconds
}

export const refreshMockToken = (token, nowSeconds = currentUnixSeconds()) => {
  const session = parseToken(token)

  if (!session) {
    return ''
  }

  return createMockToken(session.user, nowSeconds)
}

export const appendTokenToUrl = (url, token) => {
  if (!url || url === 'about:blank' || !token) {
    return url
  }

  const baseUrl = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
  const parsedUrl = new URL(url, baseUrl)
  parsedUrl.searchParams.set('token', token)
  parsedUrl.searchParams.delete('auth')
  parsedUrl.searchParams.delete('handoff')
  parsedUrl.searchParams.delete('user')
  return parsedUrl.toString()
}

export const consumeTokenFromUrl = (url) => {
  const parsedUrl = new URL(url)
  const token = parsedUrl.searchParams.get('token') || ''
  parsedUrl.searchParams.delete('token')

  return {
    token,
    cleanUrl: parsedUrl.toString(),
  }
}

export const createRequestClient = ({
  getToken,
  getRuntimeConfig = () => ({}),
  getEncryptionFlags = () => ({}),
  createTimestamp = () => ({ timestamp: String(Date.now()), sign: '' }),
  shouldSkipToken = (path) => String(path).includes('/sig/'),
  serializeData = (data) => data,
  transport,
} = {}) => {
  if (typeof transport !== 'function') {
    throw new TypeError('createRequestClient requires a transport function')
  }

  const request = (path, data, config = {}) => {
    const method = config.method || 'post'
    const runtimeConfig = getRuntimeConfig()
    const encryptionFlags = getEncryptionFlags()
    const timestampData = createTimestamp(config.format ?? true)
    const token = getToken?.() || ''

    if (!shouldSkipToken(path) && !token) {
      return Promise.reject(new Error('请求中没有token信息'))
    }

    const requestPayload =
      data === undefined || data === null || data === '' ? { apptype: 1 } : data
    const headers = {
      ...config.headers,
      appid: runtimeConfig.appid || '',
      deviceid: runtimeConfig.deviceid || '',
      timestamp: timestampData.timestamp,
      sign: timestampData.sign,
      Authorization: token,
      inParamEn: encryptionFlags.inParamEn || '0',
      outParamEn: encryptionFlags.outParamEn || '0',
      'Content-Type': config.contentType || DEFAULT_CONTENT_TYPE,
    }

    return transport({
      url: joinUrl(runtimeConfig.baseUrl || runtimeConfig.serverUrl || '', path),
      method,
      data:
        method.toLowerCase() === 'get'
          ? undefined
          : serializeData(requestPayload, {
              timestampData,
              config,
              encryptionFlags,
            }),
      params: method.toLowerCase() === 'get' ? requestPayload : undefined,
      headers,
      responseType: config.responseType,
      signal: config.signal,
      requestPath: path,
      rawData: requestPayload,
      timestampData,
    })
  }

  return {
    request,
    http: {
      get(url, params, config = {}) {
        return request(url, params, { ...config, method: 'get' })
      },
      post(url, data, config = {}) {
        return request(url, data, { ...config, method: 'post' })
      },
    },
  }
}
