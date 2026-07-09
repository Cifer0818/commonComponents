import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  TOKEN_REFRESH_WINDOW_SECONDS,
  TOKEN_TTL_SECONDS,
  appendTokenToUrl,
  consumeTokenFromUrl,
  configurePortalRuntime,
  createAxiosService,
  createAxiosTransport,
  createChildRequestClient,
  createMockToken,
  createRequestClient,
  isTokenExpired,
  parseToken,
  refreshMockToken,
  shouldRefreshToken,
} from '../src/index.js'
import { createMockToken as createMockTokenFromAuth } from '../src/auth.js'
import { consumeTokenFromUrl as consumeTokenFromEntryUrl } from '../src/entry-url.js'
import { createRequestClient as createRequestClientFromRequest } from '../src/request.js'

const stylesPath = fileURLToPath(new URL('../src/styles/index.css', import.meta.url))

const now = 1783058722
const user = {
  userId: 'local-admin',
  account: 'admin',
  name: '李主任',
  orgId: 'quality-cloud',
  deptId: 'quality-office',
}

const token = createMockToken(user, now)
const parsed = parseToken(token)

assert.equal(typeof createMockTokenFromAuth, 'function')
assert.equal(typeof consumeTokenFromEntryUrl, 'function')
assert.equal(typeof createRequestClientFromRequest, 'function')
assert.equal(typeof configurePortalRuntime, 'function')
assert.equal(typeof createAxiosService, 'function')
assert.equal(typeof createAxiosTransport, 'function')
assert.equal(typeof createChildRequestClient, 'function')
assert.equal(existsSync(stylesPath), true)
assert.equal(TOKEN_TTL_SECONDS, 7200)
assert.equal(TOKEN_REFRESH_WINDOW_SECONDS, 300)
assert.equal(token.split('.').length, 3)
assert.equal(parsed.token, token)
assert.equal(parsed.user.userId, user.userId)
assert.equal(parsed.user.account, user.account)
assert.equal(parsed.user.name, user.name)
assert.equal(parsed.user.orgId, user.orgId)
assert.equal(parsed.user.deptId, user.deptId)
assert.equal(parsed.issuedAt, now)
assert.equal(parsed.expiresAt, now + 7200)
assert.equal(parsed.expiresIn, 7200)
assert.equal(parsed.payload.exp, now + 7200)

assert.equal(isTokenExpired(token, now + 7199), false)
assert.equal(isTokenExpired(token, now + 7200), true)
assert.equal(shouldRefreshToken(token, now + 60), false)
assert.equal(shouldRefreshToken(token, now + 6900), true)

const refreshedToken = refreshMockToken(token, now + 7100)
const refreshed = parseToken(refreshedToken)

assert.notEqual(refreshedToken, token)
assert.equal(refreshed.user.userId, user.userId)
assert.equal(refreshed.issuedAt, now + 7100)
assert.equal(refreshed.expiresAt, now + 7100 + 7200)

const childUrl = appendTokenToUrl('http://localhost:5174/prescription?tab=a', token)
const parsedChildUrl = new URL(childUrl)

assert.equal(parsedChildUrl.pathname, '/prescription')
assert.equal(parsedChildUrl.searchParams.get('tab'), 'a')
assert.equal(parsedChildUrl.searchParams.get('token'), token)
assert.equal(parsedChildUrl.searchParams.has('auth'), false)
assert.equal(parsedChildUrl.searchParams.has('handoff'), false)
assert.equal(parsedChildUrl.searchParams.has('user'), false)

const consumed = consumeTokenFromUrl(childUrl)

assert.equal(consumed.token, token)
assert.equal(consumed.cleanUrl, 'http://localhost:5174/prescription?tab=a')

const requestClient = createRequestClient({
  getToken: () => token,
  getRuntimeConfig: () => ({
    baseUrl: 'http://api.local/base',
    appid: 'app-id',
    deviceid: 'device-id',
  }),
  getEncryptionFlags: () => ({
    inParamEn: '0',
    outParamEn: '0',
  }),
  createTimestamp: () => ({
    timestamp: '123456',
    sign: 'signed',
  }),
  transport: async (requestConfig) => requestConfig,
})

const requestConfig = await requestClient.http.post('/orders', { id: 1 })

assert.equal(requestConfig.url, 'http://api.local/base/orders')
assert.equal(requestConfig.method, 'post')
assert.deepEqual(requestConfig.data, { id: 1 })
assert.equal(requestConfig.headers.Authorization, token)
assert.equal(requestConfig.headers.appid, 'app-id')
assert.equal(requestConfig.headers.deviceid, 'device-id')
assert.equal(requestConfig.headers.timestamp, '123456')
assert.equal(requestConfig.headers.sign, 'signed')

const apiProxyClient = createRequestClient({
  getToken: () => token,
  getRuntimeConfig: () => ({
    baseUrl: '/api',
  }),
  transport: async (requestOptions) => requestOptions,
})
const apiProxyRequest = await apiProxyClient.http.post('api/up/ProductDataSource/GetAllDataSourceList')

assert.equal(apiProxyRequest.url, '/api/up/ProductDataSource/GetAllDataSourceList')

const axiosService = createAxiosService({
  adapter: async (config) => ({
    data: { ok: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }),
})
const axiosTransport = createAxiosTransport(axiosService)
const axiosResponse = await axiosTransport({
  url: '/health',
  method: 'get',
  headers: {
    Authorization: token,
  },
})

assert.equal(axiosResponse.status, 200)
assert.deepEqual(axiosResponse.data, { ok: true })

const storageData = new Map()
const memoryStorage = {
  getItem: (key) => storageData.get(key) || null,
  setItem: (key, value) => storageData.set(key, value),
  removeItem: (key) => storageData.delete(key),
}

const childToken = createMockToken(user)
const childParsed = parseToken(childToken)

memoryStorage.setItem(
  'medication_child_auth',
  JSON.stringify({
    token: childToken,
    user,
    issuedAt: childParsed.issuedAt,
    expiresAt: childParsed.expiresAt,
    expiresIn: childParsed.expiresIn,
  }),
)

const childClient = createChildRequestClient({
  storage: memoryStorage,
  baseUrl: 'http://child-api.local',
  appid: 'child-app',
  deviceid: 'child-device',
  adapter: async (config) => ({
    data: {
      url: config.url,
      appid: config.headers.appid,
      deviceid: config.headers.deviceid,
      authorization: config.headers.Authorization,
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }),
})
const childResponse = await childClient.http.get('/orders', { page: 1 })

assert.equal(childResponse.url, 'http://child-api.local/orders')
assert.equal(childResponse.appid, 'child-app')
assert.equal(childResponse.deviceid, 'child-device')
assert.equal(childResponse.authorization, childToken)

console.log('portal-runtime verification passed')
