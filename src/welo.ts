import path from 'path'
import { EventEmitter, CustomEvent } from '@libp2p/interfaces/events'
import * as where from 'wherearewe'
import { start, stop } from '@libp2p/interfaces/startable'
import type { GossipHelia } from '@/interface'

import { Manifest, Address } from '@/manifest/index.js'
import { Blocks } from '@/blocks/index.js'
import { WELO_PATH } from '@/utils/constants.js'
import { Playable } from '@/utils/playable.js'
import { getDatastore, DatastoreClass } from '@/utils/datastore.js'
import { Identity } from '@/identity/basal/index.js'
import {
  dirs,
  DirsReturn,
  Components,
  cidstring
} from '@/utils/index.js'
import type { ReplicatorClass } from '@/replicator/interface.js'
import type { IdentityInstance } from '@/identity/interface.js'
import type { ManifestData } from '@/manifest/interface.js'
import type { KeyChain } from '@/utils/types.js'

// import * as version from './version.js'
import { Database } from './database.js'
import type {
  ClosedEmit,
  Config,
  Create,
  Determine,
  Events,
  // FetchOptions,
  OpenedEmit,
  OpenOptions
} from './interface.js'
import type { LevelDatastore } from 'datastore-level'

export { Manifest, Address }
export type {
  Playable,
  Database,
  Config,
  Create,
  Determine,
  // FetchOptions,
  OpenOptions as Options
}

/**
 * Database Factory
 *
 * @public
 */
export class Welo extends Playable {
  private readonly replicators: ReplicatorClass[]
  private readonly datastore: DatastoreClass
  private readonly handlers: Config['handlers']

  private readonly dirs: DirsReturn
  readonly directory: string

  readonly ipfs: GossipHelia
  readonly blocks: Blocks

  readonly identities: LevelDatastore | null
  readonly keychain: KeyChain

  readonly identity: IdentityInstance<any>

  readonly events: EventEmitter<Events>

  readonly opened: Map<string, Database>
  private readonly _opening: Map<string, Promise<Database>>

  constructor ({
    directory,
    identity,
    blocks,
    identities,
    keychain,
    ipfs,
    handlers,
    datastore,
    replicators
  }: Config) {
    const starting = async (): Promise<void> => {
      // in the future it might make sense to open some stores automatically here
    }
    const stopping = async (): Promise<void> => {
      await Promise.all(Object.values(this._opening))
      await Promise.all(Object.values(this.opened).map(stop))
    }
    super({ starting, stopping })

    this.directory = directory
    this.dirs = dirs(this.directory)

    this.identity = identity
    this.blocks = blocks

    this.identities = identities
    this.keychain = keychain

    this.ipfs = ipfs

    this.events = new EventEmitter()

    this.opened = new Map()
    this._opening = new Map()

    this.handlers = handlers
    this.datastore = datastore
    this.replicators = replicators
  }

  /**
   * Create an Welo instance
   *
   * @param options - options
   * @returns a promise which resolves to an Welo instance
   */
  static async create (options: Create): Promise<Welo> {
    let directory: string = WELO_PATH
    if (where.isNode && typeof options.directory === 'string') {
      directory = options.directory ?? '.' + directory
    }

    const ipfs = options.ipfs
    if (ipfs == null) {
      throw new Error('ipfs is a required option')
    }

    let identity: IdentityInstance<any>
    let identities: LevelDatastore | null = null

    if (options.identity != null) {
      identity = options.identity
    } else {
      identities = await getDatastore(
        options.datastore,
        dirs(directory).identities
      )

      await identities.open()
      identity = await Identity.get({
        name: 'default',
        identities,
        keychain: ipfs.libp2p.keychain
      })
      await identities.close()
    }

    const config: Config = {
      directory,
      identity,
      identities,
      ipfs,
      blocks: new Blocks(ipfs),
      keychain: ipfs.libp2p.keychain,
      handlers: options.handlers,
      datastore: options.datastore,
      replicators: options.replicators ?? []
    }

    const welo = new Welo(config)

    if (options.start !== false) {
      await start(welo)
    }

    return welo
  }

  // static get version () { return version }

  /**
   * Deterministically create a database manifest
   *
   * @remarks
   * Options are shallow merged with {@link defaultManifest}.
   *
   * @param options - Override defaults used to create the manifest.
   * @returns
   */
  async determine (options: Determine): Promise<Manifest> {
    const manifestObj: ManifestData = {
      ...this.getDefaultManifest(options.name),
      ...options
    }

    const manifest = await Manifest.create(manifestObj)
    await this.blocks.put(manifest.block)

    try {
      this.getComponents(manifest)
    } catch (e) {
      console.warn('manifest configuration contains unregistered components')
    }

    return manifest
  }

  /**
   * Fetch a Database Manifest
   *
   * @remarks
   * Convenience method for using `Manifest.fetch`.
   *
   * @param address - the Address of the Manifest to fetch
   * @returns
   */
  async fetch (address: Address): Promise<Manifest> {
    return await Manifest.fetch({ blocks: this.blocks, address })
  }

  /**
   * Opens a database for a manifest.
   *
   * @remarks
   * This method will throw an error if the database is already opened or being opened.
   * Use {@link Welo.opened} to get opened databases.
   *
   * @param manifest - the manifest of the database to open
   * @param options - optional configuration for how to run the database
   * @returns the database instance for the given manifest
   */
  async open (manifest: Manifest, options: OpenOptions = {}): Promise<Database> {
    const address = manifest.address
    const addr: string = address.toString()

    if (this.opened.get(addr) != null) {
      throw new Error(`database ${addr} is already open`)
    }

    if (this._opening.get(addr) != null) {
      throw new Error(`database ${addr} is already being opened`)
    }

    let identity: IdentityInstance<any>
    if (options.identity != null) {
      identity = options.identity
    } else if (this.identity != null) {
      identity = this.identity
    } else {
      throw new Error('no identity available')
    }

    let Datastore: DatastoreClass
    if (options.Datastore != null) {
      Datastore = options.Datastore
    } else if (this.datastore != null) {
      Datastore = this.datastore
    } else {
      throw new Error('no Datastore attached to Welo class')
    }

    const replicators = options.replicators ?? this.replicators

    const directory = path.join(
      this.dirs.databases,
      cidstring(manifest.address.cid)
    )

    const components = this.getComponents(manifest)

    if (components.Access == null ||
      components.Entry == null ||
      components.Identity == null ||
      components.Store == null
    ) {
      throw new Error('missing components')
    }

    const promise = Database.open({
      directory,
      manifest,
      identity,
      ipfs: this.ipfs,
      blocks: this.blocks,
      Datastore,
      replicators,
      ...components
    })
      .then((database) => {
        this.opened.set(addr, database)
        this.events.dispatchEvent(
          new CustomEvent<OpenedEmit>('opened', {
            detail: { address }
          })
        )
        database.events.addEventListener(
          'closed',
          () => {
            this.opened.delete(addr)
            this.events.dispatchEvent(
              new CustomEvent<ClosedEmit>('closed', {
                detail: { address }
              })
            )
          },
          { once: true }
        )
        return database
      })
      .catch((e) => {
        console.error(e)
        throw new Error(`failed opening database with address: ${addr}`)
      })
      .finally(() => {
        this._opening.delete(addr)
      })

    this._opening.set(addr, promise)

    return await promise
  }

  getComponents (manifest: Manifest): Components {
    const access = this.handlers.access.find(h => h.protocol === manifest.access.protocol)
    const entry = this.handlers.entry.find(h => h.protocol === manifest.entry.protocol)
    const identity = this.handlers.identity.find(h => h.protocol === manifest.identity.protocol)
    const store = this.handlers.store.find(h => h.protocol === manifest.store.protocol)

    if (access == null || entry == null || identity == null || store == null) {
      throw new Error('missing component(s)')
    }

    return {
      Access: access,
      Entry: entry,
      Identity: identity,
      Store: store
    }
  }

  private getDefaultManifest (name: string): ManifestData {
    return {
      name,
      store: {
        protocol: this.handlers.store[0].protocol
      },
      access: {
        protocol: this.handlers.access[0].protocol,
        config: { write: [this.identity.id] }
      },
      entry: {
        protocol: this.handlers.entry[0].protocol
      },
      identity: {
        protocol: this.handlers.identity[0].protocol
      }
    }
  }
}
