import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const source = 'MapData/zomboid_world_map.png'
const metadata = await readFile('MapData/zomboid_world_map.json', 'utf8')
const { w, h } = JSON.parse(metadata)
const size = 256
const maxZoom = Math.max(0, Math.ceil(Math.log2(Math.max(w, h) / size)))
const hash = createHash('sha256').update(`webp-84-top-left-v1:${sharp.versions.vips}`).update(metadata)
for await (const chunk of createReadStream(source)) hash.update(chunk)
const version = hash.digest('hex').slice(0, 16)
const output = 'public/tiles'
const target = `${output}/${version}`
const manifest = { version, maxZoom, tileSize: size }

if (await readFile(`${target}/ready.json`, 'utf8').then(() => true, error => {
  if (error.code === 'ENOENT') return false
  throw error
})) {
  await writeFile(`${output}/manifest.json`, JSON.stringify(manifest))
  console.log('Map tiles are up to date.')
} else {
  const image = await sharp(source, { limitInputPixels: false }).metadata()
  if (image.width !== w || image.height !== h) throw new Error('Map image dimensions do not match MapData metadata.')
  const staging = `.tiles-build/${process.pid}`
  await mkdir(staging, { recursive: true })
  await mkdir(output, { recursive: true })
  try {
    await sharp(source, { limitInputPixels: false }).webp({ quality: 84 })
      .tile({ size, layout: 'google', depth: 'onetile', centre: false, background: '#21251e', skipBlanks: -1 })
      .toFile(`${staging}/pyramid`)
    const root = `${staging}/pyramid`
    await writeFile(`${root}/ready.json`, JSON.stringify(manifest))
    await rename(root, target).catch(error => {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error
      return readFile(`${target}/ready.json`)
    })
    await writeFile(`${output}/manifest.json`, JSON.stringify(manifest))
    console.log(`Generated map tiles (zoom 0-${maxZoom}).`)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
