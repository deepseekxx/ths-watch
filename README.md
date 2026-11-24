# 云端版：电脑关机也能收推送（华为手机）

思路：监控脚本跑在 **GitHub Actions**（免费、云端有 Chrome、能取同花顺令牌），有新帖就推到你的**华为手机**。
链路：GitHub 云端 → 同花顺接口 → 推送服务 → 手机，**全程不需要电脑开机**。

> ⚠️ Bark 是 iPhone 专用，华为用不了。华为按下面两个方案二选一。

---

## 第 1 步：选一个推送渠道

### 方案 A：PushPlus + 微信（最省事，鸿蒙 4 / 5 / 6 都能用）

不用装任何 App，通知直接在微信里收。

1. 手机浏览器打开 https://www.pushplus.plus ，点「微信扫码登录」。
2. 登录后按提示做 **实名认证**（免费的，用支付宝/身份证，1 分钟）。
   > 未实名的账号每天额度是 0 条，必须实名才有 200 条/天，够用。
3. 进入「一对一推送」页面，复制你的 **token**（一串 32 位字符）。
4. 记下来，第 4 步要用。名字叫 `PUSHPLUS_TOKEN`。

### 方案 B：ntfy（能装 APK 的话体验最好）

免费、不用注册、通知秒到、点通知直接打开原帖。缺点是要侧载一个 APK。

1. 用手机浏览器打开 https://f-droid.org/packages/com.heckel.ntfy/ ，点 **Download APK**；
   或者 https://github.com/binwiederhier/ntfy-android/releases 下最新 `.apk`。
2. 安装时华为会提示「未知来源应用」，允许一次即可。
3. 打开 ntfy → 右下角 **+** → **Subscribe to topic** → 输入一个只有你知道的英文串，比如
   `ths-fans-8h3k2m`（这就是你的推送频道，别人猜不到就行）。
4. 你的推送地址就是：`https://ntfy.sh/ths-fans-8h3k2m`
5. 记下来，第 4 步要用。名字叫 `NTFY_URL`。

> 怎么判断自己能不能装 APK：设置 → 关于手机 → 看「鸿蒙版本」。
> 4.x / EMUI 能装 APK；5.x、6.x（HarmonyOS NEXT）装不了，走方案 A。

---

## 第 2 步：建一个 GitHub 仓库

1. 打开 https://github.com 注册/登录。
2. 右上角 **+** → **New repository**。
3. 填：
   - Repository name：`ths-watch`
   - 可见性：**Public**（重要！公开仓库 Actions 分钟数免费无限；私有仓库每月只有 2000 分钟，10 分钟跑一次不够用）
   - 其它都不用勾
4. 点 **Create repository**。

代码公开没有隐私问题：脚本是通用的，你的 token 存在 Secrets 里，别人看不到。

---

## 第 3 步：上传两个文件

要传的是本文件夹里的：

```
.github/workflows/ths-watch.yml     ← 定时任务定义
scripts/ths-watch-ci.js             ← 云端版脚本
```

**方式 A（拖拽）**：仓库首页 → **Add file** → **Upload files** → 把 `.github` 和 `scripts` 两个文件夹一起拖进去 → **Commit changes**。

**方式 B（拖拽失败就用这个）**：
- **Add file** → **Create new file**，文件名直接打 `.github/workflows/ths-watch.yml`（打 `/` 会自动建目录），把 `ths-watch.yml` 的内容粘进去 → Commit；
- 再建一个 `scripts/ths-watch-ci.js`，粘 `ths-watch-ci.js` 的内容 → Commit。

---

## 第 4 步：把渠道信息存进 Secret

仓库页 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**。

| 你选的方案 | Name | Secret 填什么 |
| --- | --- | --- |
| A（微信） | `PUSHPLUS_TOKEN` | 第 1 步复制的 token |
| B（ntfy） | `NTFY_URL` | `https://ntfy.sh/你的topic` |

点 **Add secret**。

---

## 第 5 步：启用并测试

1. 点仓库顶部 **Actions** 标签。
2. 若提示 “Workflows aren't being run on this repository”，点绿色 **I understand my workflows, go ahead and enable them**。
3. 左侧点 **同花顺发帖监控** → 右边 **Run workflow** → 弹窗里 `test` 默认已勾选（只发一条测试）→ 再点绿色 **Run workflow**。
4. 等 30~60 秒刷新，点进运行记录看日志：
   - `ntfy 响应 200` 或 `PushPlus 响应 200`，并且手机收到「监控测试」→ 打通了。
   - 400 / 401 → token 或 topic 填错，回第 4 步改。
5. 之后不用管：每 10 分钟自动检查，有新帖就推：

   ```
   重生之散户一哥 发新帖了
   11-24 20:22｜赞1392 评751｜$华东重机(002685)$ 11月24日复盘记录 今日操作…
   ```

   点通知直接打开原帖。

---

## 第 6 步：把电脑那份关掉

云端和电脑各记各的「已读」，同时开你会收到两条。电脑上的 `启动监控.bat` / `后台启动.vbs` 别再启动就行。

---

## 要知道的几个坑

- **会有延迟**：GitHub 定时任务不精确，实际常晚 5~15 分钟，交易时段也一样。要秒级只能自己架常开设备（旧安卓手机、云服务器）。
- **60 天自动停**：仓库连续 60 天没有任何提交，GitHub 会停掉定时任务，去 Actions 页点 **Enable workflow** 恢复。
- **首次运行不推送**：第一次只记录当前最新帖，避免把旧帖当新帖轰炸你；验证推送用第 5 步的 test。
- **失败会自己报告**：连续 3 次检查失败，会推一条「监控异常」到手机，同时 Actions 标红。
- **别用私有仓库 + 10 分钟**：私有仓库每月 2000 分钟不够，要私有就把 `*/10` 改成 `*/30`。

## 如果一直 403 / 红叉

GitHub 服务器在国外，绝大多数情况能访问同花顺（已验证全球多节点返回 200）。如果日志里持续 403 或超时，说明被风控挡了，备选：

1. 旧安卓手机装 Termux 跑电脑版脚本（家里常开，零成本）；
2. 最便宜的国内云服务器（学生机约 ¥10/月），把电脑版丢上去 `nohup node ths-watch.js &`；
3. 把日志发我，看是接口变了还是 IP 被挡。

---

## 监控多个博主

改 `scripts/ths-watch-ci.js` 顶部的 `TARGETS` 数组即可，每行一个博主：

```js
const TARGETS = [
  { name: '重生之散户一哥', code: '1179giyc4jr06d6785e69e' },
  { name: 'G界红猫',       code: 'zut394ud2p34z9e54dce1' },
  { name: '77超帅',        code: '119u3kf83bfi7i09f7d058' },
].filter((t) => t.code);
```

`code` 就是博主主页链接里 `user_code=` 后面那串（在 App 里点「⋯ → 分享 → 复制链接」拿到）。
每个博主的已读记录各自独立存着，新增一个人不会影响别人；新增的那位第一次运行只记录当前最新帖，不会把旧帖当新帖推。
