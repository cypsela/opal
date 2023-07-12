import { pipe } from 'it-pipe'
import concat from 'it-concat'
import { cidstring } from '@/utils/index.js'
import { Playable } from '@/utils/playable.js'
import { encodeHeads, decodeHeads, addHeads, getHeads } from '@/utils/replicator.js'
import { Config, ReplicatorModule, prefix } from '@/replicator/interface.js'
import type { GossipHelia } from '@/interface'
import type { DbComponents } from '@/interface.js'
import type { Manifest } from '@/manifest/index.js'
import type { Blocks } from '@/blocks/index.js'
import type { Replica } from '@/replica/index.js'
import type { AccessInstance } from '@/access/interface.js'

export const protocol = `${prefix}bootstrap/1.0.0/` as const

export class BootstrapReplicator extends Playable {
  readonly ipfs: GossipHelia
  readonly manifest: Manifest
  readonly blocks: Blocks
  readonly replica: Replica
  readonly access: AccessInstance
  readonly components: Pick<DbComponents, 'entry' | 'identity'>

  constructor ({
    ipfs,
    replica,
    blocks
  }: Config) {
    const starting = async (): Promise<void> => {
			// Handle direct head requests.
			await this.libp2p.handle(this.protocol, async data => {
				await pipe([await this.encodeHeads()], data.stream);
			});

			// Bootstrap the heads
			try {
				for await (const peer of this.peers) {
					// We don't care about peers that don't support our protocol.
					if (!peer.protocols.includes(this.protocol)) {
						//continue
					}

					if (peer.id.equals(this.libp2p.peerId)) {
						continue
					}

					await this.libp2p.peerStore.save(peer.id, peer)

					const stream = await this.libp2p.dialProtocol(peer.id, this.protocol)
					const responses = await pipe(stream, itr => concat(itr, { type: "buffer" }))

					await this.parseHeads(responses.subarray());
				}
			} catch (error) {
				console.error("bootstrapping failed", error)
			}
    }

    const stopping = async (): Promise<void> => {
			await this.libp2p.unhandle(this.protocol);
    }

    super({ starting, stopping })

    this.ipfs = ipfs
    this.blocks = blocks
    this.replica = replica
    this.manifest = replica.manifest
    this.access = replica.access
    this.components = replica.components
  }

	private get libp2p () {
		return this.ipfs.libp2p;
	}

	private get peers () {
		return this.libp2p.contentRouting.findProviders(this.manifest.address.cid, {
			signal: AbortSignal.timeout(1000)
		})
	}

	private get protocol () {
		return `${protocol}${cidstring(this.manifest.address.cid)}`
	}

	private async parseHeads (message: Uint8Array) {
		const heads = await decodeHeads(message);

		await addHeads(heads, {
			replica: this.replica,
			access: this.access,
			blocks: this.blocks,
			...this.components
		})
	}

	private async encodeHeads (): Promise<Uint8Array> {
    const heads = await getHeads(this.replica, this.manifest)

		return await encodeHeads(heads);
	}
}

export const bootstrapReplicator: () => ReplicatorModule<BootstrapReplicator, typeof protocol> = () => ({
  protocol,
  create: (config: Config) => new BootstrapReplicator(config)
})
