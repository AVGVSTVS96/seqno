import { runBench } from "../src/bench.ts"
import { openNodeDb } from "../src/node-db.ts"

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]
const db = openNodeDb()
const version = String(db.all("SELECT sqlite_version()")[0]![0])
const result = runBench(db, `node:sqlite ${version} (:memory:)`, {
  ...(arg("keystrokes") ? { keystrokes: Number(arg("keystrokes")) } : {}),
  ...(arg("verify-every") ? { verifyEvery: Number(arg("verify-every")) } : {}),
})
console.log(JSON.stringify(result, null, 2))
