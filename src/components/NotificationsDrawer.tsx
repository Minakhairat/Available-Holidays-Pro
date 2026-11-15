import { Bell, CheckCheck, X } from 'lucide-react';
import { AppNotification, NotificationType } from '../types';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/firestoreService';

interface NotificationsDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: AppNotification[];
}

function getNotificationTone(type: NotificationType): string {
  switch (type) {
    case NotificationType.LEAVE_APPROVED:
    case NotificationType.SWAP_APPROVED:
    case NotificationType.SWAP_PEER_ACCEPTED:
      return 'text-emerald-700';
    case NotificationType.LEAVE_REJECTED:
    case NotificationType.LEAVE_CANCELLED:
    case NotificationType.SWAP_REJECTED:
    case NotificationType.SWAP_PEER_REJECTED:
      return 'text-[#D32F2F]';
    default:
      return 'text-neutral-800';
  }
}

export function NotificationsDrawer({
  open,
  onClose,
  notifications,
}: NotificationsDrawerProps) {
  if (!open) return null;

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white h-full flex flex-col border-r border-neutral-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 bg-[#D32F2F] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <Bell className="w-5 h-5" />
            <h2 className="text-base font-bold">الإشعارات والتنبيهات</h2>
            {unreadCount > 0 && (
              <span className="font-mono-num text-xs bg-white/20 px-2 py-0.5 rounded-md">
                {unreadCount} غير مقروء
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق الإشعارات"
            className="w-8 h-8 rounded-lg hover:bg-white/15 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {unreadCount > 0 && (
          <div className="px-4 py-2.5 bg-neutral-50 border-b border-neutral-200 flex justify-end shrink-0">
            <button
              onClick={() => markAllNotificationsRead(notifications)}
              className="text-xs font-semibold text-[#D32F2F] hover:text-[#B71C1C] flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCheck className="w-4 h-4" />
              <span>تحديد الكل كمقروء</span>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
          {notifications.length === 0 ? (
            <div className="p-10 text-center text-neutral-500">
              <Bell className="w-8 h-8 mx-auto mb-3 text-neutral-300" />
              <p className="text-sm font-semibold">لا توجد إشعارات حالياً</p>
              <p className="text-xs text-neutral-400 mt-1">
                ستظهر هنا تنبيهات قبول أو رفض الإجازات وطلبات التبديل فوراً.
              </p>
            </div>
          ) : (
            notifications.map((n) => {
              const dateStr = n.createdAt?.toDate
                ? n.createdAt.toDate().toLocaleString('ar-EG', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';

              return (
                <div
                  key={n.id}
                  onClick={() => {
                    if (!n.isRead) markNotificationRead(n.id);
                  }}
                  className={`p-4 transition-colors cursor-pointer ${
                    n.isRead ? 'bg-white hover:bg-neutral-50' : 'bg-red-50/40 hover:bg-red-50/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className={`text-sm font-bold ${getNotificationTone(n.type)}`}>
                      {n.title}
                    </h3>
                    {!n.isRead && (
                      <span className="text-[11px] font-bold text-[#D32F2F] shrink-0">
                        جديد
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                    {n.message}
                  </p>
                  {dateStr && (
                    <p className="text-[11px] text-neutral-400 mt-2 font-mono-num">
                      {dateStr}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
