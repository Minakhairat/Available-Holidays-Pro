import { CalendarCheck2, ShieldCheck, Users, ArrowLeftRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function SignInScreen() {
  const { signInWithGoogle, signingIn, authError } = useAuth();

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col justify-between">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#D32F2F] text-white flex items-center justify-center">
              <CalendarCheck2 className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold text-neutral-900 whitespace-nowrap">
              الإجازات المتاحة
            </span>
          </div>
          <button
            onClick={signInWithGoogle}
            disabled={signingIn}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#D32F2F] hover:bg-[#B71C1C] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            {signingIn ? 'جاري الدخول...' : 'تسجيل الدخول'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-7 bg-white border border-neutral-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs font-semibold text-[#D32F2F] mb-2">
                بوابة عمال الإنتاج والمشرفين
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 leading-snug mb-4">
                نظام متابعة وطلب وتبديل الإجازات اليومية والشهرية
              </h1>
              <p className="text-sm sm:text-base text-neutral-600 leading-relaxed mb-8">
                اطّلع على الإجازات المتاحة في خط إنتاجك لحظياً، أرسل طلب الإجازة لمشرفك مباشرة،
                وتبادل مواعيد الإجازة مع زملائك بسهولة عبر قاعدة بيانات فورية ومتزامنة على جميع
                الأجهزة.
              </p>

              <div className="space-y-4 border-t border-neutral-100 pt-6">
                <div className="flex items-start gap-3">
                  <CalendarCheck2 className="w-5 h-5 text-[#D32F2F] shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-sm font-bold text-neutral-900">
                      عرض فوري للإجازات المتاحة
                    </h2>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      معرفة الأيام المتاحة والمكتملة في جميع الخطوط الثمانية ليوم الغد والشهر بالكامل.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ArrowLeftRight className="w-5 h-5 text-[#D32F2F] shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-sm font-bold text-neutral-900">
                      تبديل الإجازات بين العمال
                    </h2>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      إرسال طلب تبديل لزميلك في نفس الخط واعتماده بعد موافقة الطرفين والمشرف.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-[#D32F2F] shrink-0 mt-0.5" />
                  <div>
                    <h2 className="text-sm font-bold text-neutral-900">
                      إدارة وصلاحيات المشرفين
                    </h2>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      تسجيل وإلغاء الإجازات والرد على الطلبات مباشرة مع إشعارات فورية لكل عامل.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 bg-white border border-neutral-200 rounded-xl p-6 sm:p-8 flex flex-col justify-center">
            <div className="w-12 h-12 rounded-xl bg-red-50 text-[#D32F2F] flex items-center justify-center mb-5">
              <Users className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-neutral-900 mb-2">
              الدخول إلى حسابك
            </h2>
            <p className="text-sm text-neutral-600 mb-6">
              استخدم حساب Google الخاص بك للدخول كعامل أو مشرف أو مدير للنظام.
            </p>

            {authError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {authError}
              </div>
            )}

            <button
              onClick={signInWithGoogle}
              disabled={signingIn}
              className="w-full py-3 px-4 bg-[#D32F2F] hover:bg-[#B71C1C] text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-3 cursor-pointer disabled:opacity-60 min-h-[44px]"
            >
              <svg className="w-5 h-5 bg-white rounded-full p-0.5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                />
              </svg>
              <span>{signingIn ? 'جاري تسجيل الدخول...' : 'المتابعة بحساب Google'}</span>
            </button>

            <p className="text-xs text-neutral-400 mt-5 leading-relaxed">
              يعمل النظام بالكامل على أجهزة الكمبيوتر والهواتف الذكية (iPhone و Android) والأجهزة اللوحية.
            </p>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-neutral-200 py-4 px-4 text-center text-xs text-neutral-500">
        نظام الإجازات المتاحة لعمال الإنتاج · جميع البيانات محفوظة ومؤمّنة على Firebase
      </footer>
    </div>
  );
}
