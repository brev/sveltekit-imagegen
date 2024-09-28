import type { Config, Options } from '../types'

import { access, readFile } from 'node:fs/promises'
import { cwd } from 'node:process'
import {
  deepMerge,
  imageOutputFormats,
  manifestOutputFormats,
} from './common.js'
import { extname, resolve } from 'node:path'

/**
 * Default Config
 * @see README.md
 */

export const defaultConfig: Config = {
  images: {
    formats: ['avif', 'webp', 'jpg'],
    sizes: [400, 800],
    default: {
      format: 'jpg',
      size: 800,
    },
    static: resolve('static'),
    images: 'images',
    slug: '_gen',
    version: Date.now().toString(),
  },
  manifests: {
    format: 'json',
    src: resolve('src/lib/assets/images'),
    slug: '_gen',
  },
}

// functions

export const checkConfig = (config: Config) => {
  // images.formats
  config.images.formats.forEach((format) => {
    if (!imageOutputFormats.includes(format))
      throw new Error(`Unsupported image format ${format} in 'images.formats'!`)
  })
  // images.default
  if (!imageOutputFormats.includes(config.images.default.format))
    throw new Error(
      `Unsupported image format in config 'images.default': ${config.images.default.format}!`
    )
  if (!config.images.formats.includes(config.images.default.format))
    throw new Error(
      `Image format in config 'images.default' ${config.images.default.format} not found in 'formats'!`
    )
  if (!config.images.sizes.includes(config.images.default.size))
    throw new Error(
      `Image size in config 'images.default' ${config.images.default.size} not found in 'sizes'!`
    )
  // images.version
  if (!config.images.version)
    throw new Error(`Image version missing from config 'images.version'!`)
  // manifests.format
  if (!manifestOutputFormats.includes(config.manifests.format))
    throw new Error(
      `Unsupported manifest format in config 'manifests.format': ${config.manifests.format}!`
    )
  return config
}

export const getConfig = async (options: Options) => {
  const { config: configFile, verbose } = options
  let config: Config = defaultConfig
  if (configFile) {
    // custom config file name
    const ext = extname(configFile)
    if (ext === '.json') {
      // json
      try {
        const configRaw = await readFile(resolve(cwd(), configFile), 'utf8')
        const configJson = JSON.parse(configRaw)
        config = deepMerge(config, configJson)
        if (verbose) console.log(`Config file read ${configFile}...`)
      } catch (error) {
        throw new Error(
          [
            `Cannot read or parse ${configFile}:`,
            (error as Error).message,
          ].join(' ')
        )
      }
    } else if (ext === '.js' || ext === '.cjs') {
      // js
      try {
        const { default: configJs } = await import(resolve(cwd(), configFile))
        config = deepMerge(config, configJs)
        if (verbose) console.log(`Config file import ${configFile}...`)
      } catch (error) {
        throw new Error(
          [`Cannot import ${configFile}:`, (error as Error).message].join(' ')
        )
      }
    } else {
      throw new Error('Config file format must be `js` or `json`')
    }
  } else {
    // default config file name
    const configFilename = `.web-image-gen`
    // json
    try {
      const configFile = `${configFilename}.json`
      const configPath = resolve(cwd(), configFile)
      let exists = true
      try {
        await access(configPath)
      } catch {
        exists = false
      }
      if (exists) {
        const configRaw = await readFile(configPath, 'utf8')
        const configJson = JSON.parse(configRaw)
        config = deepMerge(config, configJson)
        if (verbose) console.log(`Config file read ${configFile}...`)
      }
    } catch (error) {
      throw new Error(
        [`Cannot read or parse ${configFile}:`, (error as Error).message].join(
          ' '
        )
      )
    }
    // js
    try {
      const configFile = `${configFilename}.js`
      const configPath = resolve(cwd(), configFile)
      let exists = true
      try {
        await access(configPath)
      } catch {
        exists = false
      }
      if (exists) {
        const { default: configJs } = await import(configPath)
        config = deepMerge(config, configJs)
        if (verbose) console.log(`Config file import ${configFile}...`)
      }
    } catch (error) {
      throw new Error(
        [`Cannot import ${configFile}:`, (error as Error).message].join(' ')
      )
    }
  }

  if (config === defaultConfig && verbose)
    console.log('Using default config...')

  return checkConfig(config)
}
