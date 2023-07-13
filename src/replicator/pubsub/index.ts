import { cidstring } from '@/utils/index.js'
import { Playable } from '@/utils/playable.js'
import { encodeHeads, decodeHeads, addHeads, getHeads } from '@/utils/replicator.js'
import { Config, ReplicatorModule, prefix } from '@/replicator/interface.js'
import type { GossipHelia, GossipLibp2p } from '@/interface'
import type { DbComponents } from '@/interface.js'
import type { Manifest } from '@/manifest/index.js'
import type { Blocks } from '@/blocks/index.js'
import type { Replica } from '@/replica/index.js'
import type { AccessInstance } from '@/access/interface.js'
import type { Message, PubSub } from '@libp2p/interface-pubsub'

export const protocol = `${prefix}pubsub/1.0.0/` as const

export class PubsubReplicator extends Playable {
  readonly ipfs: GossipHelia
  readonly manifest: Manifest
  readonly blocks: Blocks
  readonly replica: Replica
  readonly access: AccessInstance
  readonly components: Pick<DbComponents, 'entry' | 'identity'>

  private readonly onReplicaHeadsUpdate: () => void
  private readonly onPubsubMessage: (evt: CustomEvent<Message>) => void

  constructor ({
    ipfs,
    replica,
    blocks
  }: Config) {
    const starting = async (): Promise<void> => {
      this.replica.events.addEventListener('write', this.onReplicaHeadsUpdate)

      this.pubsub.subscribe(this.protocol)
      this.pubsub.addEventListener('message', this.onPubsubMessage)
    }

    const stopping = async (): Promise<void> => {
      this.replica.events.removeEventListener('write', this.onReplicaHeadsUpdate)

      this.pubsub.unsubscribe(this.protocol)
      this.pubsub.removeEventListener('message', this.onPubsubMessage)
    }

    super({ starting, stopping })

    this.ipfs = ipfs
    this.blocks = blocks
    this.replica = replica
    this.manifest = replica.manifest
    this.access = replica.access
    this.components = replica.components

    this.onReplicaHeadsUpdate = this.broadcast.bind(this) as () => void
    this.onPubsubMessage = this.parseHeads.bind(this) as (evt: CustomEvent<Message>) => void
  }

  private get libp2p (): GossipLibp2p {
    return this.ipfs.libp2p
  }

  private get pubsub (): PubSub {
    return this.libp2p.services.pubsub
  }

  private get protocol (): string {
    return `${protocol}${cidstring(this.manifest.address.cid)}`
  }

  private async parseHeads (evt: CustomEvent<Message>): Promise<void> {
    const heads = await decodeHeads(evt.detail.data)

    await addHeads(heads, this.replica, this.components)
  }

  private async encodeHeads (): Promise<Uint8Array> {
    const heads = await getHeads(this.replica)

    return await encodeHeads(heads)
  }

  private async broadcast (): Promise<void> {
    await this.pubsub.publish(this.protocol, await this.encodeHeads())
  }
}

export const pubsubReplicator: () => ReplicatorModule<PubsubReplicator, typeof protocol> = () => ({
  protocol,
  create: (config: Config) => new PubsubReplicator(config)
})