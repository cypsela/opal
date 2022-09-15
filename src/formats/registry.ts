/**
 * the goal is to register components in src/index.js or have the user do it
 * that file would be where the dependencies are injected
 * a user going straight to src/orbitdb.js could choose what dependencies to inject
 *
 * namespaces are used for prefixing the types of components
 * so an entry isnt registered as an identity
 *
 */
import { Keyvalue } from './store/keyvalue'
import { StaticAccess } from './access/default'
import { Entry } from './entry/default'
import { Identity } from './identity/default'

type StoreType = typeof Keyvalue
type AccessType = typeof StaticAccess
type EntryType = typeof Entry
type IdentityType = typeof Identity

const $tar = Symbol.for('*')

export const errors = {
  // namespaceMismatch: (namespace: string, type: string) =>
  //   new Error(
  //     `component type '${type}' exists outside of namespace '${namespace}'`
  //   ),
  typeRegistered: (type: string) =>
    new Error(`a component with type '${type}' is already registered`),
  typeNotRegistered: (type: string) =>
    new Error(`no component with type '${type}' is registered`),
  aliasRegistered: (alias: string) =>
    new Error(`a component already exists at type alias '${alias}'`),
  noStar: () => new Error('no star component')
}

type Registered<T> = Map<string | typeof $tar, T>

export class Register<T> {
  registered: Registered<T>
  readonly starKey: typeof $tar

  constructor (public namespace?: string) {
    // will bring this back better using interface-datastore Key .parent and .name
    // this.namespace = namespace
    this.registered = new Map()
    this.starKey = $tar
  }

  add (component: any, star = Object.keys(this.registered).length === 0): void {
    // if (!component.type.startsWith(this.namespace)) {
    //   throw errors.namespaceMismatch(this.namespace, component.type)
    // }

    if (this.registered.has(component.type)) {
      throw errors.typeRegistered(component.type)
    }

    if (star) {
      this.registered.set($tar, component)
    }

    this.registered.set(component.type, component)
  }

  get (type: string): T {
    if (!this.registered.has(type)) {
      throw errors.typeNotRegistered(type)
    }
    return this.registered.get(type) as T
  }

  alias (type: string, alias: string | typeof $tar): void {
    if (!this.registered.has(type)) {
      throw errors.typeNotRegistered(type)
    }

    this.registered.set(alias, this.registered.get(type) as T)
  }

  // the favorite/default component
  get star (): T {
    if (!this.registered.has($tar)) {
      throw errors.noStar()
    }

    return this.registered.get($tar) as T
  }
}

export interface RegistryObj {
  store: Register<StoreType>
  access: Register<AccessType>
  entry: Register<EntryType>
  identity: Register<IdentityType>
}

export const initRegistry = (): RegistryObj => ({
  store: new Register<StoreType>(),
  access: new Register<AccessType>(),
  entry: new Register<EntryType>(),
  identity: new Register<IdentityType>()
})
