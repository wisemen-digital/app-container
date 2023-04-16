/* eslint-disable no-console */
import http, { ServerResponse } from 'http'
import express, { Express } from 'express'
import { Histogram, Counter } from 'prom-client'
import { register } from './metrics'

export abstract class AppContainer {
  public readonly app: Express = express()

  private state: 'starting' | 'ready' | 'shutdown' | 'unknown'
  private server?: http.Server

  private readonly ERROR_RANGE_START = 500
  private readonly ERROR_RANGE_END = 600

  private readonly httpRequestDuration: Histogram<string>
  private readonly httpRequestCounter: Counter<string>
  private readonly httpErrorCounter: Counter<string>

  constructor () {
    console.log('starting server')

    this.state = 'starting'

    process.on('SIGTERM', () => { void this.destroy() })
    process.on('SIGINT', () => { void this.destroy() })
    process.on('SIGUSR2', () => { void this.destroy() })
    process.on('SIGHUP', () => { void this.destroy() })

    // Rate
    this.httpRequestCounter = new Counter({
      name: 'http_request_total',
      help: 'Total number of HTTP requests made.',
      labelNames: ['method', 'route', 'status'],
      registers: [register]
    })

    // Error
    this.httpErrorCounter = new Counter({
      name: 'http_error_total',
      help: 'Total number of HTTP errors.',
      labelNames: ['method', 'route', 'status'],
      registers: [register]
    })

    // Duration
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds.',
      labelNames: ['method', 'route', 'status'],
      registers: [register],
      buckets: [0.1, 0.2, 0.5, 1, 2, 5, 10]
    })

    void this.up().then(() => { void this.initialize() })
  }

  abstract up (): Promise<void>
  abstract down (): Promise<void>
  abstract populate (app: Express): void

  protected async initialize (): Promise<void> {
    this.app.get('/', (_, res) => this.version(res))
    this.app.get('/health', (_, res) => this.liveness(res))
    this.app.get('/ready', (_, res) => this.readiness(res))

    this.app.use((req, res, next) => {
      const end = this.httpRequestDuration.startTimer()
      const route = req.path ?? 'unknown_route'

      res.on('finish', () => {
        const { statusCode } = res

        const isError = statusCode >= this.ERROR_RANGE_START && statusCode < this.ERROR_RANGE_END

        const labels = {
          method: req.method,
          route,
          status: statusCode
        }

        this.httpRequestCounter.inc(labels)

        if (isError) this.httpErrorCounter.inc(labels)

        end(labels)
      })

      next()
    })

    this.app.get('/metrics', (_, res) => this.metrics(res))

    this.populate(this.app)

    this.server = this.app.listen(process.env.PORT ?? 3000, () => {
      console.log('server started')

      this.state = 'ready'
    })
  }

  private async destroy (): Promise<void> {
    console.log('shutting down server')

    this.state = 'shutdown'

    await this.down()

    this.server?.close(() => {
      void this.down().finally(() => {
        console.log('server shutdown')
      })
    })
  }

  private liveness (res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.write('OK')
    res.end()
  }

  private readiness (res: ServerResponse): void {
    if (this.state === 'ready') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.write('OK')
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.write('not OK')
    }

    res.end()
  }

  private metrics (res: ServerResponse): void {
    if (this.state !== 'ready') {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.write('not OK')
      return
    }

    register.metrics()
      .then(string => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.write(string)
      })
      .catch(() => {
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.write('not OK')
      })
      .finally(() => {
        res.end()
      })
  }

  private version (res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write(JSON.stringify({
      env: process.env.NODE_ENV
    }))
    res.end()
  }
}
