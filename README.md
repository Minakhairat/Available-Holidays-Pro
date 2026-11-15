# الإجازات المتاحة — دليل النشر عبر GitHub Pages

تم تجهيز المشروع بالكامل للنشر التلقائي على **GitHub Pages** باستخدام **GitHub Actions**، بدون التأثير على واجهة البرنامج أو قاعدة بيانات Firebase.

## خطوات النشر على GitHub

1. **إنشاء مستودع (Repository) على GitHub** ورفع جميع ملفات المشروع إلى الفرع الرئيسي (`main` أو `master`):
   ```bash
   git init
   git add .
   git commit -m "Initial deploy setup"
   git branch -M main
   git remote add origin https://github.com/<USERNAME>/<REPO_NAME>.git
   git push -u origin main
   ```

2. **تفعيل GitHub Pages**:
   - افتح المستودع على GitHub ثم انتقل إلى **Settings** > **Pages**.
   - تحت **Build and deployment** اختر **Source: GitHub Actions**.
   - سيقوم ملف `.github/workflows/deploy.yml` ببناء المشروع ونشره تلقائياً عند كل `push`.

3. **تفعيل تسجيل الدخول بحساب Google على نطاق GitHub (خطوة مهمة جداً)**:
   - افتح [Firebase Console](https://console.firebase.google.com/) واختر المشروع `gen-lang-client-0761904551`.
   - انتقل إلى **Authentication** > **Settings** > **Authorized domains**.
   - اضغط **Add domain** وأضف نطاق GitHub Pages الخاص بك:
     `<USERNAME>.github.io`
   - بدون هذه الخطوة لن يعمل زر تسجيل الدخول بحساب Google على رابط `github.io`.
