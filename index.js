const core = require('@actions/core')
const fs = require('fs')
const execa = require('execa')

void async function main() {
  try {
    await ssh()
    await accessToken()
    await dep()
  } catch (err) {
    core.setFailed(err.message)
  }
}()

async function ssh() {
  let sshHomeDir = `${process.env['HOME']}/.ssh`

  if (!fs.existsSync(sshHomeDir)) {
    fs.mkdirSync(sshHomeDir)
  }

  // If it is self-hosted we don't need to start the ssh agent
  if (!core.getBooleanInput('self-hosted')) {
    let authSock = '/tmp/ssh-auth.sock'
    execa.sync('ssh-agent', ['-a', authSock])
    core.exportVariable('SSH_AUTH_SOCK', authSock)
  }

  let privateKey = core.getInput('private-key')
  if (privateKey !== '') {
    privateKey = privateKey.replace('/\r/g', '').trim() + '\n'
    execa.sync('ssh-add', ['-'], {input: privateKey})
  }

  const knownHosts = core.getInput('known-hosts')
  if (knownHosts !== '') {
    fs.appendFileSync(`${sshHomeDir}/known_hosts`, knownHosts)
    fs.chmodSync(`${sshHomeDir}/known_hosts`, '600')
  } else {
    fs.appendFileSync(`${sshHomeDir}/config`, `StrictHostKeyChecking no`)
    fs.chmodSync(`${sshHomeDir}/config`, '600')
  }

  let sshConfig = core.getInput('ssh-config')
  if (sshConfig !== '') {
    fs.writeFileSync(`${sshHomeDir}/config`, sshConfig)
    fs.chmodSync(`${sshHomeDir}/config`, '600')
  }
}

async function accessToken() {
  let accessToken = core.getInput('access-token')
  let accessTokenUser = core.getInput('access-token-user')
  let tokenRepository = core.getInput('access-token-repository')

  if (accessToken !== '' && accessTokenUser !== '' && tokenRepository !== '') {
    // Convert to https if it's a git url
    if (tokenRepository.startsWith('git@')) {
      // Example: git@github.com:owner/repo.git
      tokenRepository = tokenRepository.replace(/:/, '/') // Replace the colon with a slash
      tokenRepository = tokenRepository.replace(/^git@/, 'https://') // Replace the git@ with https://
    }

    // Add access token to remote so https://user:token@github.com/owner/repo.git
    tokenRepository = tokenRepository.replace(/^https:\/\//, `https://${accessTokenUser}:${accessToken}@`)

    // Set remote, so it will use the token, init is in case it isn't tracked
    execa.commandSync('/usr/bin/git init')
    execa.commandSync(`/usr/bin/git remote set-url origin ${tokenRepository}`)
  }
}

async function dep() {
  let dep = core.getInput('deployer-binary')

  if (dep === '')
  for (let c of ['vendor/bin/deployer.phar', 'vendor/bin/dep', 'deployer.phar']) {
    if (fs.existsSync(c)) {
      dep = c
      console.log(`Using "${c}".`)
      break
    }
  }

  if (dep === '') {
    let version = core.getInput('deployer-version')
    if (version === '') {
      console.log(`Downloading "https://deployer.org/deployer.phar".`)
      execa.commandSync('curl -LO https://deployer.org/deployer.phar')
    } else {
      version = version.replace(/^v/, '')
      let {stdout} = execa.commandSync(`curl -L https://deployer.org/manifest.json`)
      let manifest = JSON.parse(stdout)
      let url
      for (let asset of manifest) {
        if (asset.version === version) {
          url = asset.url
          break
        }
      }
      if (url === null) {
        console.error(`The version "${version}"" does not exist in the "https://deployer.org/manifest.json" file."`)
      } else {
        console.log(`Downloading "${url}".`)
        execa.commandSync(`curl -LO ${url}`)
      }
    }
    execa.commandSync('chmod +x deployer.phar')
    dep = 'deployer.phar'
  }

  let cmd = core.getInput('dep')
  let ansi = core.getBooleanInput('ansi') ? '--ansi' : '--no-ansi';
  let verbosity = core.getInput('verbosity');

  let p = execa.command(`php ${dep} --no-interaction ${ansi} ${verbosity} ${cmd}`)
  p.stdout.pipe(process.stdout)
  p.stderr.pipe(process.stderr)

  try {
    await p
  } catch (err) {
    core.setFailed(`Failed: dep ${cmd}`)
  }
}
