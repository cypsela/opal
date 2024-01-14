/* eslint-disable no-console */
import { assert } from 'aegir/chai'
import { start, stop } from '@libp2p/interface/startable'
import type { LevelDatastore } from 'datastore-level'
import { Key } from 'interface-datastore'
import { NamespaceDatastore } from 'datastore-core'

import { zzzyncReplicator, type ZzzyncReplicator } from '@/replicator/zzzync/index.js'
import { Replica } from '@/replica/index.js'
import { StaticAccess as Access } from '@/access/static/index.js'
import staticAccessProtocol from '@/access/static/protocol.js'

import { getLevelDatastore, getVolatileStorage } from '../test-utils/storage.js'
import { getTestPaths, tempPath, TestPaths } from '../test-utils/constants.js'
import { getTestManifest } from '../test-utils/manifest.js'
import { getTestIdentities, getTestIdentity } from '../test-utils/identities.js'
import { basalEntry } from '@/entry/basal/index.js'
import { basalIdentity } from '@/identity/basal/index.js'
// import { Web3Storage } from 'web3.storage'
import type { PeerId } from '@libp2p/interface/peer-id'
import { createLibp2p, Libp2p, Libp2pOptions } from 'libp2p'
import { CID } from 'multiformats'
import { createEd25519PeerId } from '@libp2p/peer-id-factory'
import { getLibp2pDefaults } from '../test-utils/libp2p/defaults.js'
import { getBlockPeerConnectionGater } from '../test-utils/libp2p/connectionGater.js'
import { getIdentifyService, type AllServices, getPubsubService, getDhtService } from '../test-utils/libp2p/services.js'
import type { Helia } from '@helia/interface'
import { createHelia } from 'helia'
import { getPeerDiscovery } from '../test-utils/libp2p/peerDiscovery.js'
import { waitForMultiaddrs } from '../test-utils/network.js'

import type { CreateEphemeralKadDHT } from '@tabcat/zzzync/dist/src/advertisers/dht.js'
import { isBrowser } from 'wherearewe'
import { Pinner, zzzync } from '@tabcat/zzzync'
import { w3Namer, revisionState } from '@tabcat/zzzync/namers/w3'
import { dhtAdvertiser } from '@tabcat/zzzync/advertisers/dht'
// import { w3Pinner } from '@tabcat/zzzync/pinners/w3'
import W3NameService from 'w3name/service'

const testName = 'replicator/zzzync'
const token = process.env.W3_TOKEN as string

const noToken = typeof token === 'string' && token.length === 0

let _describe: Mocha.SuiteFunction | Mocha.PendingSuiteFunction
if (noToken) {
  // eslint-disable-next-line no-console
  console.log('no web3.storage token found at .w3_token. skipping zzzync replicator tests')
  _describe = describe.skip
} else {
  _describe = describe.skip
}

type Services = Pick<AllServices, 'identify' | 'pubsub' | 'dht'>
if (isBrowser) {
  _describe = describe.skip
}

_describe(testName, () => {
  let
    helia1: Helia<Libp2p<Services>>,
    helia2: Helia<Libp2p<Services>>,
    libp2p1: Libp2p<Services>,
    libp2p2: Libp2p<Services>,
    replica1: Replica,
    replica2: Replica,
    replicator1: ZzzyncReplicator,
    replicator2: ZzzyncReplicator,
    testPaths1: TestPaths,
    testPaths2: TestPaths,
    access: Access,
    datastore: LevelDatastore,
    datastore1: NamespaceDatastore,
    datastore2: NamespaceDatastore

  before(async () => {
    testPaths1 = getTestPaths(tempPath, testName + '/1')
    testPaths2 = getTestPaths(tempPath, testName + '/2')

    datastore = await getLevelDatastore(testPaths1.replica)
    await datastore.open()
    datastore1 = new NamespaceDatastore(datastore, new Key(testPaths1.replica))
    datastore2 = new NamespaceDatastore(datastore, new Key(testPaths2.replica))

    const peerId1 = await createEd25519PeerId()
    const peerId2 = await createEd25519PeerId()
    // blocks peering so block fetching happens over web3.storage
    const createLibp2pOptions = async (): Promise<Libp2pOptions<Services>> => ({
      ...(await getLibp2pDefaults()),
      peerDiscovery: await getPeerDiscovery(),
      services: {
        identify: getIdentifyService(),
        pubsub: getPubsubService(),
        dht: getDhtService(true)
      }
    })

    const storage1 = getVolatileStorage()
    const storage2 = getVolatileStorage()

    libp2p1 = await createLibp2p({
      ...(await createLibp2pOptions()),
      connectionGater: getBlockPeerConnectionGater(peerId2),
      datastore: storage1.datastore
    })
    libp2p2 = await createLibp2p({
      ...(await createLibp2pOptions()),
      connectionGater: getBlockPeerConnectionGater(peerId1),
      datastore: storage2.datastore
    })

    await Promise.all([
      waitForMultiaddrs(libp2p1),
      waitForMultiaddrs(libp2p2)
    ])

    helia1 = await createHelia({
      ...storage1,
      libp2p: libp2p1
    })
    helia2 = await createHelia({
      ...storage2,
      libp2p: libp2p2
    })

    const identities1 = await getTestIdentities(testPaths1)
    const identities2 = await getTestIdentities(testPaths2)

    const identity1 = await getTestIdentity(
      identities1,
      libp2p1.keychain,
      testName
    )
    const identity2 = await getTestIdentity(
      identities2,
      libp2p2.keychain,
      testName
    )

    const write = [identity1.id, identity2.id]
    const accessConfig = {
      access: { protocol: staticAccessProtocol, config: { write } }
    }
    const manifest = await getTestManifest(testName, accessConfig)

    access = new Access({ manifest })
    await start(access)

    replica1 = new Replica({
      manifest,
      datastore: datastore1,
      blockstore: helia1.blockstore,
      access,
      identity: identity1,
      components: {
        entry: basalEntry(),
        identity: basalIdentity()
      }
    })
    replica2 = new Replica({
      manifest,
      datastore: datastore2,
      blockstore: helia2.blockstore,
      access,
      identity: identity2,
      components: {
        entry: basalEntry(),
        identity: basalIdentity()
      }
    })
    await start(replica1, replica2)

    if (token == null) {
      throw new Error('w3 token is undefined')
    }

    // const client = new Web3Storage({ token })

    const createEphemeralKadDHT: CreateEphemeralKadDHT = async (peerId: PeerId) => {
      const libp2p = await createLibp2p({ ...(await createLibp2pOptions()), peerId })

      await waitForMultiaddrs(libp2p)

      return libp2p.services
    }

    const zzzync1 = zzzyncReplicator(zzzync(
      w3Namer(new W3NameService(), revisionState(datastore1)),
      dhtAdvertiser(libp2p1.services.dht, createEphemeralKadDHT),
      // w3Pinner(client)
      undefined as unknown as Pinner
    ))
    const zzzync2 = zzzyncReplicator(zzzync(
      w3Namer(new W3NameService(), revisionState(datastore2)),
      dhtAdvertiser(libp2p2.services.dht, createEphemeralKadDHT),
      // w3Pinner(client)
      undefined as unknown as Pinner
    ))

    replicator1 = zzzync1.create({
      peerId: peerId1,
      replica: replica1,
      datastore: datastore1,
      blockstore: helia1.blockstore
    })
    replicator2 = zzzync2.create({
      peerId: peerId2,
      replica: replica2,
      datastore: datastore2,
      blockstore: helia2.blockstore
    })
  })

  after(async () => {
    await stop(access)
    await stop(replicator1, replicator2)
    await stop(replica1, replica2)
    await stop(helia1)
    await stop(helia2)
    await datastore.close()
  })

  describe('instance', () => {
    before(async () => {
      await start(replicator1, replicator2)
    })

    it('exposes instance properties', () => {
      const replicator = replicator1
      assert.isOk(replicator.download)
      assert.isOk(replicator.upload)
    })

    it('uploads and advertises replica data', async () => {
      await replica1.write(new Uint8Array())

      await replicator1.upload()
    })

    it('downloads and merges replica data', async () => {
      await replicator2.download()

      if (!(replica1.root instanceof CID) || !(replica2.root instanceof CID)) {
        throw new Error()
      }
      assert.equal(replica1.root.toString(), replica2.root.toString())
    })
  })
})