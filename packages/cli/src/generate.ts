import type { Config, ImageSets, Options } from '../types'
import type { FormatEnum } from 'sharp'

import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import {
  getFlags,
  getServePath,
  imageOutputFormats,
  shortPath,
} from './common.js'
import prettier from 'prettier'
import sharp from 'sharp'

/**
 * Generate
 */
export default async (config: Config, options: Options) => {
  const { force, only, verbose } = getFlags(options)
  const servePath = getServePath(config)
  const imageOutputRegExp = new RegExp(`\\.(${imageOutputFormats.join('|')})`)

  // main
  const imageRoot = resolve(config.images.static, config.images.images)
  const imageDirs = (await readdir(imageRoot, { withFileTypes: true }))
    .filter((dir) => dir.isDirectory())
    .map((dir) => dir.name)

  for (const imageDir of imageDirs) {
    const imageDirPath = resolve(imageRoot, imageDir)
    const manifest: ImageSets = {}
    let manifestWrite = only != 'images' ? true : false

    if (verbose)
      console.log(
        `Processing original source images dir: ${shortPath(imageDirPath)}`
      )
    const imageFiles = (await readdir(imageDirPath, { withFileTypes: true }))
      .filter(
        (file) =>
          file.isFile() &&
          imageOutputFormats.includes(extname(file.name).replace('.', ''))
      )
      .map((file) => file.name)

    for (const imageFile of imageFiles) {
      const imageSlug = imageFile.replace(imageOutputRegExp, '')
      const imagePath = resolve(imageDirPath, imageFile)
      const metaPath = imagePath.replace(imageOutputRegExp, '.json')
      const genDirPath = resolve(imageDirPath, config.images.slug)
      const sharpFile = sharp(imagePath)
      const metadata = await sharpFile.metadata()

      console.log(sharpFile)

      const sharpPromises = []
      let metaExists = true
      manifest[imageSlug] = {
        default: '',
        formats: {},
        meta: null,
        placeholder: '',
        sizes: {},
        width: metadata.width || 0,
        height: metadata.height || 0,
      }

      // load metadata if exists
      try {
        await access(metaPath)
      } catch {
        metaExists = false
      }
      if (metaExists) {
        const meta = JSON.parse((await readFile(metaPath)).toString())
        manifest[imageSlug].meta = meta
      }

      // low quality image placeholder (lqip)
      sharpPromises.push(
        sharpFile
          .clone()
          .resize({ width: 16 })
          .toFormat('webp', {
            alphaQuality: 20,
            quality: 20,
            smartSubsample: true,
          })
          .toBuffer()
      )

      // check if image 'generated' dir exists and create if missing
      if (only != 'manifests') {
        try {
          await access(genDirPath)
        } catch {
          if (verbose)
            console.log(
              `Creating generated images dir: ${shortPath(genDirPath)}`
            )
          await mkdir(genDirPath, { recursive: true })
        }
      }

      // generate sizes
      for (const size of config.images.sizes) {
        const sharpSize = sharpFile.clone().resize({ width: size })

        manifest[imageSlug].sizes[size] = {}

        // generate sized formats
        for (const format of config.images.formats) {
          const genFile = `${imageSlug}-${size}.${format}`
          const genPath = resolve(genDirPath, genFile)
          const sharpFormat = sharpSize
            .clone()
            .toFormat(format as keyof FormatEnum, {
              mozjpeg: /jpe?g/.test(format),
            })
          let imageExists = true

          if (!manifest[imageSlug].formats[format])
            manifest[imageSlug].formats[format] = {}
          manifest[imageSlug].formats[format][size] = servePath(genPath)
          manifest[imageSlug].sizes[size][format] = servePath(genPath)

          if (only === 'manifests') continue

          // check if image already exists
          if (!force && only != 'manifests') {
            try {
              await access(genPath)
            } catch {
              imageExists = false
            }
            if (imageExists) continue
          }

          // queue image generation
          if (verbose)
            console.log(`Creating generated image file: ${shortPath(genPath)}`)
          manifestWrite = only != 'images'
          sharpPromises.push(sharpFormat.clone().toFile(genPath))
        }

        // default image for set
        manifest[imageSlug].default =
          manifest[imageSlug].formats[config.images.default.format][
            config.images.default.size
          ]
      }

      // generate images - run all queued
      const [lqip] = await Promise.all(sharpPromises)

      // low quality image placeholder (lqip) for set
      const dataURI = `data:image/webp;base64,${lqip.toString('base64')}`
      manifest[imageSlug].placeholder = dataURI
    }

    // manifest
    if (manifestWrite) {
      const manifestPath = resolve(config.manifests.src, config.manifests.slug)
      const manifestFile = resolve(
        manifestPath,
        `${imageDir}.${config.manifests.format}`
      )

      // check if manifest 'generated' dir exists and create if missing
      try {
        await access(manifestPath)
      } catch {
        if (verbose)
          console.log(
            `Creating generated manifests dir: ${shortPath(manifestPath)}`
          )
        await mkdir(manifestPath, { recursive: true })
      }

      // generate manifest
      if (verbose)
        console.log(
          `Creating generated manifest file: ${shortPath(manifestFile)}`
        )
      let manifestSrc = JSON.stringify(manifest, null, '  ')
      if (config.manifests.format === 'js' || config.manifests.format === 'ts')
        manifestSrc = `export default ${manifestSrc}`

      await writeFile(
        manifestFile,
        await prettier.format(manifestSrc, { filepath: manifestFile })
      )
    }
  }
}
