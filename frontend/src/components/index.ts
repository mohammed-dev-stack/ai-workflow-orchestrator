// frontend/src/components/index.ts

// ============================================================
// المصدر الوحيد (SSoT) لاستيراد جميع مكونات الواجهة الأمامية
// ============================================================

// ============================================================
// الذرات (Atoms) — أصغر وحدات البناء
// ============================================================
export {
  Button,
  default as ButtonDefault,
} from './atoms/Button';
export type { ButtonProps } from './atoms/Button';
export type { ButtonVariant, ButtonSize } from './atoms/Button';

export {
  Input,
  default as InputDefault,
} from './atoms/Input';
export type { InputProps } from './atoms/Input';
export type { InputSize } from './atoms/Input';

export {
  Spinner,
  LoadingSpinner,
  default as SpinnerDefault,
} from './atoms/Spinner';
export type { SpinnerProps } from './atoms/Spinner';
export type { SpinnerSize, SpinnerVariant } from './atoms/Spinner';

export {
  SkipLink,
  default as SkipLinkDefault,
} from './atoms/SkipLink';
export type { SkipLinkProps } from './atoms/SkipLink';

export {
  Toaster,
  default as ToasterDefault,
} from './atoms/Toaster';
export type { Toast, ToasterProps } from './atoms/Toaster';
export type { ToastVariant, ToastPosition } from './atoms/Toaster';

export {
  ErrorBoundary,
  default as ErrorBoundaryDefault,
} from './atoms/ErrorBoundary';
export type { ErrorBoundaryProps, ErrorBoundaryState } from './atoms/ErrorBoundary';

// ============================================================
// الجزيئات (Molecules) — مجموعات من الذرات
// ============================================================
export {
  SearchBar,
  default as SearchBarDefault,
} from './molecules/SearchBar';
export type { SearchBarProps } from './molecules/SearchBar';

export {
  DocumentCard,
  default as DocumentCardDefault,
} from './molecules/DocumentCard';
export type { DocumentCardProps } from './molecules/DocumentCard';

export {
  ChatBubble,
  default as ChatBubbleDefault,
} from './molecules/ChatBubble';
export type { ChatBubbleProps } from './molecules/ChatBubble';

export {
  KnowledgeBaseCard,
  default as KnowledgeBaseCardDefault,
} from './molecules/KnowledgeBaseCard';
export type { KnowledgeBaseCardProps } from './molecules/KnowledgeBaseCard';

// ============================================================
// الكائنات العضوية (Organisms) — مكونات مستقلة وكاملة
// ============================================================
export {
  Modal,
  default as ModalDefault,
} from './organisms/Modal';
export type { ModalProps } from './organisms/Modal';
export type { ModalSize } from './organisms/Modal';

export {
  PageHeader,
  default as PageHeaderDefault,
} from './organisms/PageHeader';
export type { PageHeaderProps, PageHeaderAction } from './organisms/PageHeader';

export {
  Dashboard,
  default as DashboardDefault,
} from './organisms/Dashboard';
export type { DashboardProps, DashboardStats } from './organisms/Dashboard';

export {
  Sidebar,
  default as SidebarDefault,
} from './organisms/Sidebar';
export type { SidebarProps, NavItem } from './organisms/Sidebar';

export {
  ChatWindow,
  default as ChatWindowDefault,
} from './organisms/ChatWindow';
export type { ChatWindowProps } from './organisms/ChatWindow';

// ============================================================
// الصفحات (Pages) — صفحات التطبيق الكاملة
// ============================================================
export {
  LoginPage,
  default as LoginPageDefault,
} from './pages/LoginPage';
export type { LoginPageProps } from './pages/LoginPage';

export {
  KnowledgeBasePage,
  default as KnowledgeBasePageDefault,
} from './pages/KnowledgeBasePage';
export type { KnowledgeBasePageProps } from './pages/KnowledgeBasePage';

export {
  ChatPage,
  default as ChatPageDefault,
} from './pages/ChatPage';
export type { ChatPageProps } from './pages/ChatPage';

export {
  AnalyticsPage,
  default as AnalyticsPageDefault,
} from './pages/AnalyticsPage';
export type { AnalyticsPageProps, TimeRange } from './pages/AnalyticsPage';

export {
  DashboardPage,
  default as DashboardPageDefault,
} from './pages/DashboardPage';
export type { DashboardPageProps } from './pages/DashboardPage';

// ============================================================
// تصدير الكائن الافتراضي (لتجميع جميع المكونات)
// ============================================================
// ملاحظة: هذه الاستيرادات تتطلب وجود ملفات index.ts في كل مجلد فرعي.
// في حال عدم وجودها، استخدم المسارات المباشرة أو أزل هذا التجميع.
import * as atoms from './atoms';
import * as molecules from './molecules';
import * as organisms from './organisms';
import * as pages from './pages';

export default {
  atoms,
  molecules,
  organisms,
  pages,
};