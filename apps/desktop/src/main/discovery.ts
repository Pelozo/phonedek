import { createSocket, type Socket } from 'node:dgram'
import { DISCOVERY_PORT, encodeBeacon, encodeProbe, isProbe } from '@phonedek/shared'
import { lanAddresses } from './lan'
import type { Logger } from './logger'

export interface DiscoveryOptions {
  getPort: () => number
  getName: () => string
  version: string
  logger?: Logger
  port?: number
}

/**
 * Small UDP beacon so the phone can find desktops without typing an IP.
 * Never broadcasts the pairing token.
 */
export class DiscoveryService {
  private socket: Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly options: DiscoveryOptions
  private readonly port: number

  constructor(options: DiscoveryOptions) {
    this.options = options
    this.port = options.port ?? DISCOVERY_PORT
  }

  get running(): boolean {
    return this.socket !== null
  }

  async start(): Promise<boolean> {
    if (this.socket) return true
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    this.socket = socket

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const onError = (error: Error): void => {
        if (!settled) {
          settled = true
          reject(error)
        }
      }
      socket.once('error', onError)
      socket.bind(this.port, '0.0.0.0', () => {
        settled = true
        socket.off('error', onError)
        resolve()
      })
    }).catch((error) => {
      this.options.logger?.warn(`Discovery disabled: ${(error as Error).message}`)
      this.socket = null
      try {
        socket.close()
      } catch {
        // ignore
      }
      return false
    })

    if (!this.socket) return false

    socket.on('error', (error) => this.options.logger?.warn(`Discovery socket error: ${error.message}`))
    socket.on('message', (message, rinfo) => {
      if (!isProbe(message.toString('utf8'))) return
      this.sendBeacon(rinfo.address, rinfo.port)
    })

    this.broadcast()
    this.timer = setInterval(() => this.broadcast(), 2500)
    this.timer.unref?.()
    this.options.logger?.info(`Discovery listening on UDP ${this.port}`)
    return true
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const socket = this.socket
    this.socket = null
    if (socket) {
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
  }

  private beaconPayload(): Buffer {
    return Buffer.from(
      encodeBeacon({
        name: this.options.getName(),
        port: this.options.getPort(),
        version: this.options.version,
      }),
      'utf8',
    )
  }

  private broadcast(): void {
    const socket = this.socket
    if (!socket) return
    const payload = this.beaconPayload()
    const targets = new Set<string>(['255.255.255.255'])
    for (const item of lanAddresses()) {
      if (item.broadcast) targets.add(item.broadcast)
    }
    for (const address of targets) {
      try {
        socket.send(payload, 0, payload.length, this.port, address, () => {
          // Network unreachable is normal (VPN down, Wi-Fi off, etc.).
        })
      } catch {
        // ignore
      }
    }
  }

  private sendBeacon(address: string, port: number): void {
    const socket = this.socket
    if (!socket) return
    const payload = this.beaconPayload()
    try {
      socket.send(payload, 0, payload.length, port, address, () => {})
    } catch {
      // ignore
    }
  }
}

export { encodeProbe }
