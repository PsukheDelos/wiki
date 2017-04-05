'use strict'

const Promise = require('bluebird')
const exec = require('execa')
const fs = Promise.promisifyAll(require('fs-extra'))
const https = require('follow-redirects').https
const path = require('path')
const pm2 = Promise.promisifyAll(require('pm2'))
const tar = require('tar')
const zlib = require('zlib')
const inquirer = require('inquirer')
const colors = require('colors/safe')
const _ = require('lodash')

let installDir = path.resolve(__dirname, '../..')

console.info(colors.yellow(
  ' __    __ _ _    _    _     \n' +
  '/ / /\\ \\ (_) | _(_)  (_)___ \n' +
  '\\ \\/  \\/ / | |/ / |  | / __| \n' +
  ' \\  /\\  /| |   <| |_ | \\__ \\ \n' +
  '  \\/  \\/ |_|_|\\_\\_(_)/ |___/ \n' +
  '                   |__/\n'))

var ora = require('ora')({ text: 'Initializing...', spinner: 'dots12' }).start()

ora.text = 'Looking for running instances...'
pm2.connectAsync().then(() => {
  return pm2.describeAsync('wiki').then(() => {
    ora.text = 'Stopping and deleting process from pm2...'
    return pm2.deleteAsync('wiki')
  }).catch(err => { // eslint-disable-line handle-callback-err
    return true
  })
}).then(() => {
  /**
   * Fetch version from npm package
   */
  return fs.readJsonAsync('package.json').then((packageObj) => {
    let versionGet = _.chain(packageObj.version).split('.').take(4).join('.')
    let remoteURL = _.replace('https://github.com/Requarks/wiki/releases/download/v{0}/wiki-js.tar.gz', '{0}', versionGet)

    return new Promise((resolve, reject) => {
      /**
       * Fetch tarball
       */
      ora.text = 'Looking for latest release...'
      https.get(remoteURL, resp => {
        if (resp.statusCode !== 200) {
          return reject(new Error('Remote file not found'))
        }
        ora.text = 'Install tarball found. Downloading...'

        /**
         * Extract tarball
         */
        resp.pipe(zlib.createGunzip())
        .pipe(tar.Extract({ path: installDir }))
        .on('error', err => reject(err))
        .on('end', () => {
          ora.text = 'Tarball extracted successfully.'
          resolve(true)
        })
      })
    })
  })
}).then(() => {
  ora.text = 'Installing Wiki.js npm dependencies...'
  return exec.stdout('npm', ['install', '--only=production', '--no-optional'], {
    cwd: installDir
  }).then(results => {
    ora.text = 'Wiki.js npm dependencies installed successfully.'
    return true
  })
}).then(() => {
  fs.accessAsync(path.join(installDir, 'config.yml')).then(() => {
    /**
     * Upgrade mode
     */
    ora.succeed('Upgrade completed.')
    return false
  }).catch(err => {
    /**
     * Install mode
     */
    if (err.code === 'ENOENT') {
      ora.text = 'First-time install, creating a new config.yml...'
      return fs.copyAsync(path.join(installDir, 'config.sample.yml'), path.join(installDir, 'config.yml')).then(() => {
        ora.succeed('Installation succeeded.')
        return true
      })
    } else {
      return err
    }
  }).then((isNewInstall) => {
    if (process.stdout.isTTY) {
      inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'Continue with configuration wizard?',
        default: 'default',
        choices: [
          { name: 'Yes, run configuration wizard on port 3000 (recommended)', value: 'default', short: 'Yes' },
          { name: 'Yes, run configuration wizard on a custom port...', value: 'custom', short: 'Yes' },
          { name: 'No, I\'ll configure the config file manually', value: 'exit', short: 'No' }
        ]
      }, {
        type: 'input',
        name: 'customport',
        message: 'Custom port to use:',
        default: 3000,
        validate: (val) => {
          val = _.toNumber(val)
          return (_.isNumber(val) && val > 0) ? true : 'Invalid Port!'
        },
        when: (ans) => {
          return ans.action === 'custom'
        }
      }]).then((ans) => {
        switch (ans.action) {
          case 'default':
            console.info(colors.bold.cyan('> Browse to http://your-server:3000/ to configure your wiki!'))
            ora = require('ora')({ text: 'I\'ll wait until you\'re done ;)', color: 'yellow', spinner: 'pong' }).start()
            return exec.stdout('node', ['wiki', 'configure'], {
              cwd: installDir
            })
          case 'custom':
            console.info(colors.bold.cyan('> Browse to http://your-server:' + ans.customport + '/ to configure your wiki!'))
            ora = require('ora')({ text: 'I\'ll wait until you\'re done ;)', color: 'yellow', spinner: 'pong' }).start()
            return exec.stdout('node', ['wiki', 'configure', ans.customport], {
              cwd: installDir
            })
          default:
            console.info(colors.bold.cyan('> Open config.yml in your favorite editor. Then start Wiki.js using: node wiki start'))
            process.exit(0)
            break
        }
      }).then(() => {
        ora.succeed(colors.bold.green('Wiki.js has been configured and is now running!'))
      })
    } else {
      console.info('[!] Non-interactive terminal detected. You may now manually edit config.yml and start Wiki.js by running: node wiki start')
    }
  })
}).catch(err => {
  ora.fail(err)
}).finally(() => {
  pm2.disconnect()
})