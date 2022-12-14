<!-- Do not edit this file. It is automatically generated by API Documenter. -->

[Home](./index.md) &gt; [opal](./opal.md) &gt; [Database](./opal.database.md) &gt; [open](./opal.database.open.md)

## Database.open() method

Open a Database

<b>Signature:</b>

```typescript
static open(options: DbOpen): Promise<Database>;
```

## Parameters

|  Parameter | Type | Description |
|  --- | --- | --- |
|  options | DbOpen | Contains properties and modules for the database to use |

<b>Returns:</b>

Promise&lt;[Database](./opal.database.md)<!-- -->&gt;


## Remarks

Opal database factory uses this method, and provides the modules needed, to return databases from its `open` instance method.
