import path from 'path'
import { assert } from './utils/chai.js'
import { LevelDatastore } from 'datastore-level'
import type { GossipHelia, GossipLibp2p } from '@/interface'

import { Database } from '../src/database.js'
import { Keyvalue as Store } from '@/store/keyvalue/index.js'
import { StaticAccess as Access, StaticAccess } from '@/access/static/index.js'
import { Entry } from '@/entry/basal/index.js'
import { Identity } from '@/identity/basal/index.js'
import { Manifest } from '@/manifest/index.js'
import { Blocks } from '@/blocks/index.js'
import type { DatastoreClass } from '@/utils/datastore.js'

import defaultManifest from './utils/defaultManifest.js'
import { getTestPaths, tempPath } from './utils/constants.js'
import { getTestIpfs, offlineIpfsOptions } from './utils/ipfs.js'
import { getTestIdentities, getTestIdentity } from './utils/identities.js'
import { getTestLibp2p } from './utils/libp2p.js'

const testName = 'database'

describe(testName, () => {
  let ipfs: GossipHelia,
    libp2p: GossipLibp2p,
    blocks: Blocks,
    database: Database,
    manifest: Manifest,
    identity: Identity,
    directory: string,
    Datastore: DatastoreClass

  before(async () => {
    const testPaths = getTestPaths(tempPath, testName)
    ipfs = await getTestIpfs(testPaths, offlineIpfsOptions)
    blocks = new Blocks(ipfs)

    const identities = await getTestIdentities(testPaths)
    libp2p = await getTestLibp2p(ipfs)

    identity = await getTestIdentity(identities, libp2p.keychain, testName)

    manifest = await Manifest.create({
      ...defaultManifest('name', identity),
      access: {
        protocol: StaticAccess.protocol,
        config: { write: [identity.id] }
      }
    })

    directory = path.join(testPaths.test, manifest.address.toString())
    Datastore = LevelDatastore
  })

  after(async () => {
    await ipfs.stop()
  })

  describe('class', () => {
    it('exposes static properties', () => {
      assert.isOk(Database.open)
    })

    describe('open', () => {
      it('returns a new Database instance', async () => {
        database = await Database.open({
          directory,
          Datastore,
          manifest,
          identity,
          ipfs,
          blocks,
          Store,
          Access,
          Entry,
          Identity,
          replicators: [] // empty replicator
        })
      })
    })
  })

  describe('instance', () => {
    it('exposes instance properties', () => {
      assert.isOk(database.blocks)
      assert.isOk(database.identity)
      assert.isOk(database.replica)
      assert.isOk(database.manifest)
      assert.isOk(database.store)
      assert.isOk(database.access)
      assert.isOk(database.Entry)
      assert.isOk(database.Identity)
      // see about doing this with generics
      // assert.isOk(database.put);
      // assert.isOk(database.del);
      // assert.isOk(database.get);
      assert.isOk(database.events)
      assert.isOk(database.close)
    })

    describe('close', () => {
      it('resets the database state', async () => {
        assert.strictEqual(database.isStarted(), true)
        await database.close()
        assert.strictEqual(database.isStarted(), false)
      })
    })
  })
})
