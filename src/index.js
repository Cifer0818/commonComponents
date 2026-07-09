console.log('[portal-runtime] commonComponents loaded')

import axios from 'axios'

export const TOKEN_TTL_SECONDS = 2 * 60 * 60
export const TOKEN_REFRESH_WINDOW_SECONDS = 5 * 60

const DEFAULT_CONTENT_TYPE = 'application/json; charset=utf-8'
const DEFAULT_AXIOS_TIMEOUT = 15000
const DEFAULT_CHILD_AUTH_STORAGE_KEY = 'medication_child_auth'

const portalRuntimeConfig = {
  childRequest: {},
}

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

const getBrowserSessionStorage = () => {
  if (typeof window === 'undefined') {
    return null
  }

  return window.sessionStorage
}

const writeJson = (storage, key, value) => {
  storage?.setItem(key, JSON.stringify(value))
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

export const createAxiosService = ({
  baseURL = '',
  timeout = DEFAULT_AXIOS_TIMEOUT,
  headers,
  onResponse,
  onResponseError,
  ...axiosConfig
} = {}) => {
  const service = axios.create({
    baseURL,
    timeout,
    headers,
    ...axiosConfig,
  })

  service.interceptors.response.use(
    typeof onResponse === 'function' ? onResponse : (response) => response,
    typeof onResponseError === 'function' ? onResponseError : (error) => Promise.reject(error),
  )

  return service
}

export const createAxiosTransport =
  (service) =>
  (requestConfig) => {
    if (typeof service !== 'function') {
      return Promise.reject(new TypeError('createAxiosTransport requires an axios service'))
    }

    return service({
      ...requestConfig,
      transformRequest: [(value) => value],
    })
  }

export const configurePortalRuntime = (config = {}) => {
  portalRuntimeConfig.childRequest = {
    ...portalRuntimeConfig.childRequest,
    ...(config.childRequest || {}),
  }

  return {
    ...portalRuntimeConfig,
  }
}

const normalizeChildSessionFromToken = (token) => {
  const parsedToken = parseToken(token)

  if (!parsedToken) {
    return null
  }

  return {
    token,
    user: {
      ...parsedToken.user,
      id: parsedToken.user.userId,
      userName: parsedToken.user.userName || parsedToken.user.name,
      org_id: parsedToken.user.orgId,
      org_name: parsedToken.user.orgName,
      dept_id: parsedToken.user.deptId,
      dept_name: parsedToken.user.deptName,
    },
    issuedAt: parsedToken.issuedAt,
    expiresAt: parsedToken.expiresAt,
    expiresIn: parsedToken.expiresIn,
  }
}

const clearChildSession = ({ storage, authStorageKey }) => {
  storage?.removeItem(authStorageKey)
}

const redirectChildUnauthorized = ({ storage, authStorageKey, unauthorizedPath }) => {
  clearChildSession({ storage, authStorageKey })

  if (typeof window !== 'undefined' && unauthorizedPath) {
    window.location.replace(unauthorizedPath)
  }
}

const resolveChildRequestOptions = (options = {}) => ({
  ...portalRuntimeConfig.childRequest,
  ...options,
  authStorageKey:
    options.authStorageKey ||
    portalRuntimeConfig.childRequest.authStorageKey ||
    DEFAULT_CHILD_AUTH_STORAGE_KEY,
  storage:
    options.storage || portalRuntimeConfig.childRequest.storage || getBrowserSessionStorage(),
  unauthorizedPath:
    options.unauthorizedPath ||
    portalRuntimeConfig.childRequest.unauthorizedPath ||
    '/unauthorized',
})

const ensureChildRequestSession = (options = {}, nowSeconds = currentUnixSeconds()) => {
  const resolvedOptions = resolveChildRequestOptions(options)
  const { storage, authStorageKey } = resolvedOptions
  const session = parseJson(storage?.getItem(authStorageKey))

  if (!session?.token) {
    redirectChildUnauthorized(resolvedOptions)
    return null
  }

  if (!shouldRefreshToken(session.token, nowSeconds)) {
    return session
  }

  const refreshedSession = normalizeChildSessionFromToken(refreshMockToken(session.token, nowSeconds))

  if (!refreshedSession) {
    redirectChildUnauthorized(resolvedOptions)
    return null
  }

  writeJson(storage, authStorageKey, refreshedSession)
  return refreshedSession
}

export const createChildRequestClient = (options = {}) => {
  const service = createAxiosService({
    timeout: options.timeout ?? DEFAULT_AXIOS_TIMEOUT,
    adapter: options.adapter,
    onResponse: options.onResponse || ((response) => response.data),
    onResponseError:
      options.onResponseError ||
      ((error) => {
        if (error.response?.status === 401) {
          redirectChildUnauthorized(resolveChildRequestOptions(options))
          return Promise.reject(new Error('登录状态已失效'))
        }

        return Promise.reject(error)
      }),
  })

  return createRequestClient({
    getToken: () => ensureChildRequestSession(options)?.token || '',
    getRuntimeConfig: () => {
      const resolvedOptions = resolveChildRequestOptions(options)

      return {
        baseUrl: resolvedOptions.baseUrl || resolvedOptions.baseURL || '',
        appid: resolvedOptions.appid || 'medication-quality-control',
        deviceid: resolvedOptions.deviceid || 'browser',
      }
    },
    getEncryptionFlags: () => ({
      inParamEn: '0',
      outParamEn: '0',
    }),
    transport: createAxiosTransport(service),
  })
}

let defaultChildRequestClient = null

export const getChildRequestClient = () => {
  if (!defaultChildRequestClient) {
    defaultChildRequestClient = createChildRequestClient()
  }

  return defaultChildRequestClient
}

export const childRequest = (...args) => getChildRequestClient().request(...args)

export const childHttp = {
  get: (...args) => getChildRequestClient().http.get(...args),
  post: (...args) => getChildRequestClient().http.post(...args),
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
