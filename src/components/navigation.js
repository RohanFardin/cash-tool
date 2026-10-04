'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Home, ListPlus, PieChart, Menu, X, Banknote, UsersRound, Truck, ShoppingBasket, ReceiptText, Bike, LogOut, UserCog } from 'lucide-react'
import { logoutAction } from '@/app/actions'

const entries = [
  ['/cash-sales', 'Cash Sales', Banknote], ['/credit-recovery', 'Due / Recovery', UsersRound],
  ['/supplier', 'Supplier', Truck], ['/local-supplier', 'Local Supplier', ShoppingBasket],
  ['/overhead-cost', 'Overhead Cost', ReceiptText], ['/conveyance', 'Conveyance', Bike],
]

function Item({ href, label, Icon, onClick }) {
  const path = usePathname()
  const active = path === href || (href !== '/admin' && path.startsWith(`${href}/`))
  return <Link href={href} onClick={onClick} className={active ? 'nav-link active' : 'nav-link'}><Icon size={20} /><span>{label}</span></Link>
}

export function UserNavigation({ name }) {
  const [open, setOpen] = useState(false)
  return <>
    <header className="mobile-header"><div><strong>Pharmacy Accounts</strong><small>{name}</small></div><button className="icon-button" onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button></header>
    {open && <button className="drawer-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />}
    <aside className={`user-sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark">Rx</span><div><strong>Pharmacy Accounts</strong><small>Daily finance</small></div><button className="icon-button close" onClick={() => setOpen(false)}><X /></button></div>
      <nav><Item href="/dashboard" label="Dashboard" Icon={Home} onClick={() => setOpen(false)} /><p className="nav-label">History</p>{entries.map(([href, label, Icon]) => <Item key={href} href={href} label={label} Icon={Icon} onClick={() => setOpen(false)} />)}<p className="nav-label">Report</p><Item href="/summary" label="Today's Summary" Icon={PieChart} onClick={() => setOpen(false)} /></nav>
      <form action={logoutAction}><button className="nav-link logout"><LogOut size={20} />Logout</button></form>
    </aside>
    <nav className="bottom-nav"><Item href="/dashboard" label="Home" Icon={Home} /><Item href="/dashboard#credit" label="Entries" Icon={ListPlus} /><Item href="/summary" label="Summary" Icon={PieChart} /><button onClick={() => setOpen(true)} className="nav-link"><Menu size={20} /><span>Menu</span></button></nav>
  </>
}

export function AdminNavigation({ name }) {
  const [open, setOpen] = useState(false)
  const links = [['/admin/summary', 'Daily Summary', PieChart], ...entries.map(([href, label, Icon]) => [`/admin${href}`, label, Icon]), ['/admin/users', 'Users', UserCog]]
  return <>
    <header className="mobile-header"><div><strong>Admin Console</strong><small>{name}</small></div><button className="icon-button" onClick={() => setOpen(true)}><Menu /></button></header>
    {open && <button className="drawer-backdrop" onClick={() => setOpen(false)} />}
    <aside className={`user-sidebar admin-sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark">Rx</span><div><strong>Admin Console</strong><small>{name}</small></div><button className="icon-button close" onClick={() => setOpen(false)}><X /></button></div>
      <nav>{links.map(([href, label, Icon]) => <Item key={href} href={href} label={label} Icon={Icon} onClick={() => setOpen(false)} />)}</nav>
      <form action={logoutAction}><button className="nav-link logout"><LogOut size={20} />Logout</button></form>
    </aside>
    <nav className="bottom-nav admin-bottom-nav"><Item href="/admin/summary" label="Summary" Icon={PieChart} /><Item href="/admin/cash-sales" label="Cash Sales" Icon={Banknote} /><button onClick={() => setOpen(true)} className="nav-link"><Menu size={20} /><span>Menu</span></button></nav>
  </>
}
