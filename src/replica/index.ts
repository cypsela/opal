import { EventEmitter, CustomEvent } from '@libp2p/interfaces/events'
import { CID } from 'multiformats/cid'
import { Key } from 'interface-datastore'
import { equals } from 'uint8arrays/equals'
import { start, stop } from '@libp2p/interfaces/startable'
import all from 'it-all'
import PQueue from 'p-queue'
import type { Datastore } from 'interface-datastore'
import type { Blockstore } from 'interface-blockstore'
import type { BlockView } from 'multiformats/interface'

import { Playable } from '@/utils/playable.js'
import { decodedcid, encodedcid, parsedcid } from '@/utils/index.js'
import { Blocks } from '@/blocks/index.js'
import type { Paily } from '@/utils/paily.js'
import type { DbComponents } from '@/interface.js'
import type { IdentityInstance } from '@/identity/interface.js'
import type { EntryInstance } from '@/entry/interface.js'
import type { Manifest } from '@/manifest/index.js'
import type { AccessInstance } from '@/access/interface.js'

import { Graph, GraphRoot } from './graph.js'
import {
  loadEntry,
  graphLinks,
  sortEntries,
  sortEntriesRev,
  traverser
} from './traversal.js'
import type { Edge } from './graph-node.js'

const rootHashKey = new Key('rootHash')

interface ReplicaEvents {
  write: CustomEvent<undefined>
  update: CustomEvent<undefined>
}

export class Replica extends Playable {
  readonly manifest: Manifest
  readonly blocks: Blocks
  readonly identity: IdentityInstance<any>
  readonly access: AccessInstance
  readonly events: EventEmitter<ReplicaEvents>
  readonly components: Pick<DbComponents, 'entry' | 'identity'>

  #datastore: Datastore
  #blockstore: Blockstore
  #graph: Graph | null

  _queue: PQueue

  root: CID | null

  constructor ({
    manifest,
    datastore,
    blockstore,
    blocks,
    access,
    identity,
    components
  }: {
    manifest: Manifest
    datastore: Datastore
    blockstore: Blockstore
    blocks: Blocks
    identity: IdentityInstance<any>
    access: AccessInstance
    components: Pick<DbComponents, 'entry' | 'identity'>
  }) {
    const starting = async (): Promise<void> => {
      const root: BlockView<GraphRoot> | null = await getRoot(
        this.#datastore,
        this.#blockstore
      ).catch(() => null)

      this.#graph = new Graph(this.#blockstore, root?.value)
      await start(this.#graph)

      if (root?.cid == null) {
        await this.#updateRoot()
      } else {
        this.root = root.cid
      }
    }
    const stopping = async (): Promise<void> => {
      await this._queue.onIdle()
      await stop(this.#graph)
      this.#graph = null
    }

    super({ starting, stopping })

    this.manifest = manifest
    this.blocks = blocks
    this.access = access
    this.identity = identity
    this.components = components

    this.#datastore = datastore
    this.#blockstore = blockstore
    this.#graph = null
    this._queue = new PQueue({})

    this.root = null

    this.events = new EventEmitter()
  }

  get graph (): Graph {
    if (this.#graph == null) {
      throw new Error('Cannot read graph before replica is started')
    }

    return this.#graph
  }

  get heads (): Paily {
    return this.graph.heads
  }

  get tails (): Paily {
    return this.graph.tails
  }

  get missing (): Paily {
    return this.graph.missing
  }

  get denied (): Paily {
    return this.graph.denied
  }

  async traverse (
    { direction }: { direction: 'descend' | 'ascend' } = {
      direction: 'descend'
    }
  ): Promise<Array<EntryInstance<any>>> {
    const blocks = this.blocks
    const entry = this.components.entry
    const identity = this.components.identity

    const graph = this.graph.clone()
    await start(graph)

    const headsAndTails = [graph.heads, graph.tails]

    let edge: Edge, orderFn: typeof sortEntries | typeof sortEntriesRev
    if (direction === 'descend') {
      edge = 'out'
      orderFn = sortEntries
    } else if (direction === 'ascend') {
      // heads and tails are switched if traversal is ascending
      headsAndTails.reverse()
      edge = 'in'
      orderFn = sortEntriesRev
    } else {
      throw new Error('unknown direction given')
    }
    // todo: less wordy way to assign heads and tails from direction
    const [heads, tails] = headsAndTails

    const cids = (await all(heads.queryKeys({}))).map(key => parsedcid(key.baseNamespace()))
    const load = loadEntry({ blocks, entry, identity })
    const links = graphLinks({ graph, tails, edge })

    return await traverser({ cids, load, links, orderFn })
  }

  async has (cid: CID | string): Promise<boolean> {
    if (!this.isStarted()) {
      throw new Error('replica not started')
    }

    return await this.graph.has(cid)
  }

  async known (cid: CID | string): Promise<boolean> {
    if (!this.isStarted()) {
      throw new Error('replica not started')
    }

    return await this.graph.known(cid)
  }

  async add (entries: Array<EntryInstance<any>>): Promise<void> {
    if (this.#datastore == null || this.#blockstore == null) {
      throw new Error('replica not started')
    }

    const clone = this.graph.clone()

    for await (const entry of entries) {
      if (!equals(entry.tag, this.manifest.getTag())) {
        console.warn('replica received entry with mismatched tag')
        continue
      }

      await this.blocks.put(entry.block)
      await this.blocks.put(entry.identity.block)

      if (await this.access.canAppend(entry)) {
        await this.graph.add(entry.cid, entry.next)
      } else {
        await this.graph.deny(entry.cid)
      }
    }

    if (!this.graph.equals(clone)) {
      await this.#updateRoot()
    }
  }

  async write (payload: any): Promise<EntryInstance<any>> {
    if (!this.isStarted()) {
      throw new Error('replica not started')
    }

    const entry = await this.components.entry.create({
      identity: this.identity,
      tag: this.manifest.getTag(),
      payload,
      next: (await all(this.heads.queryKeys({}))).map((key) => CID.parse(key.baseNamespace())),
      refs: [] // refs are empty for now
    })

    await this.blocks.put(entry.block)

    return await this.add([entry]).then(() => {
      this.events.dispatchEvent(new CustomEvent<undefined>('write'))
      return entry
    })
  }

  // useful when the access list is updated
  // async deny (entries) {
  //   for await (const entry of entries) {
  //
  //   }
  // }

  async #updateRoot (): Promise<void> {
    const block = await encodeRoot(this.graph.root)
    await setRoot(this.#datastore, this.#blockstore, block)
    this.root = block.cid
    this.events.dispatchEvent(new CustomEvent<undefined>('update'))
  }
}

const encodeRoot = async (root: GraphRoot): Promise<BlockView<GraphRoot>> => await Blocks.encode({ value: root })

const getRoot = async (
  datastore: Datastore,
  blockstore: Blockstore
): Promise<BlockView<GraphRoot>> => {
  try {
    const rootHash = await datastore.get(rootHashKey)
    const bytes = await blockstore.get(decodedcid(rootHash))
    return await Blocks.decode<GraphRoot>({ bytes })
  } catch (e) {
    throw new Error('failed to get root')
  }
}

const setRoot = async (
  datastore: Datastore,
  blockstore: Blockstore,
  block: BlockView<GraphRoot>
): Promise<void> => {
  try {
    await Promise.all([
      blockstore.put(block.cid, block.bytes),
      datastore.put(rootHashKey, encodedcid(block.cid))
    ])
  } catch (e) {
    throw new Error('failed to get root')
  }
}
