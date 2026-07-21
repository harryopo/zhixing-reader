/**
 * Layout — 兼容旧调用，内部委托给 AppShell
 * 新代码应直接使用 AppShell
 */

import { ReactNode } from 'react'
import AppShell from './AppShell'
import ErrorBoundary from '../ErrorBoundary'

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <AppShell>
      <ErrorBoundary>{children}</ErrorBoundary>
    </AppShell>
  )
}
