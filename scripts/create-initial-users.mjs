import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !secretKey) {
  console.error([
    'Missing Supabase provisioning credentials.',
    'Set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) in .env.local.',
    'This must be a server-only secret key, never a publishable/NEXT_PUBLIC key.',
  ].join('\n'))
  process.exit(1)
}

let projectUrl
try {
  projectUrl = new URL(url)
} catch {
  console.error('NEXT_PUBLIC_SUPABASE_URL is not a valid URL.')
  process.exit(1)
}

if (projectUrl.hostname === 'your-project.supabase.co' || projectUrl.hostname.includes('your-project')) {
  console.error([
    'NEXT_PUBLIC_SUPABASE_URL is still using the example placeholder.',
    'Remove the placeholder NEXT_PUBLIC_SUPABASE_URL from .env.local so the real value in .env is used.',
  ].join('\n'))
  process.exit(1)
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  realtime: { transport: WebSocket },
})

const accounts = [
  {
    username: 'user',
    email: 'user@pharmacy.local',
    fullName: 'User',
    role: 'user',
    suppliedPassword: process.env.INITIAL_USER_PASSWORD,
  },
  {
    username: 'admin',
    email: 'admin@pharmacy.local',
    fullName: 'Administrator',
    role: 'superadmin',
    suppliedPassword: process.env.INITIAL_ADMIN_PASSWORD,
  },
]

function generatedPassword() {
  return `${randomBytes(18).toString('base64url')}aA1!`
}

async function findUser(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const match = data.users.find((user) => user.email?.toLowerCase() === email)
    if (match || data.users.length < 100) return match || null
  }
  throw new Error('User lookup exceeded the supported account range.')
}

async function provision(account) {
  const existing = await findUser(account.email)
  if (existing) {
    return {
      username: account.username,
      created: false,
      message: 'Already exists; its password cannot be retrieved. Reset it in Supabase Authentication if necessary.',
    }
  }

  const password = account.suppliedPassword || generatedPassword()
  if (password.length < 12) throw new Error(`${account.username} password must contain at least 12 characters.`)

  const { data, error } = await supabase.auth.admin.createUser({
    email: account.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: account.fullName },
  })
  if (error) throw error

  const { error: profileError } = await supabase.from('profiles').update({
    full_name: account.fullName,
    role: account.role,
  }).eq('id', data.user.id)
  if (profileError) throw profileError

  return { username: account.username, created: true, password }
}

try {
  const results = []
  for (const account of accounts) results.push(await provision(account))

  console.log('\nInitial account result\n----------------------')
  for (const result of results) {
    console.log(`Username: ${result.username}`)
    if (result.created) {
      console.log(`Password: ${result.password}`)
      console.log('Status: Created and confirmed')
    } else {
      console.log(`Status: ${result.message}`)
    }
    console.log('')
  }
  console.log('Save newly generated passwords now; Supabase will not reveal them again.')
} catch (error) {
  console.error(`Unable to provision initial users: ${error.message}`)
  if (error.cause?.code) console.error(`Network error: ${error.cause.code}`)
  if (error.cause?.message) console.error(`Details: ${error.cause.message}`)
  process.exit(1)
}
