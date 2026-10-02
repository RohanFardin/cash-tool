import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Page({ params }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: report } = await supabase.from('daily_reports').select('business_date').eq('id', id).in('status', ['submitted', 'approved']).maybeSingle()
  redirect(report ? '/admin/summary?date=' + report.business_date : '/admin/summary')
}
