# ERMM 系統架構與流程圖說明

> 企業資源管理與製造系統 (Enterprise Resource Management & Manufacturing)
> 技術堆疊：Classic ASP (VBScript) + IIS + SQL Server + MySQL
> 編碼：CodePage=936 (GB2312 簡體中文)

---

## 目錄

1. [系統總體架構](#一系統總體架構)
2. [技術堆疊](#二技術堆疊)
3. [登入與權限流程](#三登入與權限流程)
4. [資料庫架構與多租戶切換](#四資料庫架構與多租戶切換)
5. [核心業務模組關係](#五核心業務模組關係)
6. [ERP 整合與批次作業流程](#六erp-整合與批次作業流程)
7. [頁面編碼體系](#七頁面編碼體系)
8. [日誌與稽核機制](#八日誌與稽核機制)
9. [整體關係總結](#九整體關係總結)

---

## 一、系統總體架構

```mermaid
flowchart TB
    subgraph Client["客戶端 / 瀏覽器"]
        UI["ASP + HTML + CSS + JS<br/>BootStrap 3.4.1<br/>ichartjs 圖表"]
    end

    subgraph IIS["IIS Web Server (Windows)"]
        LOGIN["login.asp<br/>登入頁"]
        CHECK["check.asp<br/>驗證 + 授權"]
        MAIN["main.asp<br/>框架頁 frameset"]
        INDEX["index.asp<br/>頂部 header"]
        LEFT["left_new.asp<br/>左側選單"]
        BODY["body.asp<br/>主內容 iframe"]
    end

    subgraph Public["公共元件層 public/"]
        CONN["conn.asp<br/>資料庫連線"]
        ENC["encrypt.asp / Crypt.asp<br/>加密"]
        LOG["start_log.asp / end_log.asp<br/>操作日誌"]
        MAIL["send_email.asp<br/>JMail 郵件"]
        UPLOAD["upload.asp<br/>檔案上傳"]
        CONFIG["config.asp<br/>權限檢查"]
    end

    subgraph Business["業務模組層"]
        HM["HM/<br/>主管理+品質"]
        MO["mo/<br/>製造訂單"]
        BATCH["batch/<br/>批次+ERP整合"]
        CLEAR["clearance/<br/>海關報關"]
        FIN["finance/<br/>財務"]
        EISM["EISMII/<br/>EIS庫存"]
        SMS["SMS/<br/>簡訊驗證"]
    end

    subgraph DB["資料庫層"]
        SQL[("SQL Server<br/>ERMM_HM / ERMM_LD<br/>ERMM_MQ / ERMM_JS 等")]
        MYSQL[("MySQL<br/>talent_db")]
    end

    subgraph Ext["外部系統"]
        ERP["外部 ERP<br/>(採購單PO/製令MO)"]
        SMTP["SMTP 郵件伺服器"]
        SMSGW["簡訊閘道 API"]
    end

    UI --> LOGIN
    LOGIN --> CHECK
    CHECK --> MAIN
    MAIN --> INDEX
    MAIN --> LEFT
    MAIN --> BODY
    BODY --> Business
    LEFT --> Business
    Business --> Public
    Public --> SQL
    Public --> MYSQL
    BATCH --> ERP
    MAIL --> SMTP
    SMS --> SMSGW
```

### 架構分層說明

| 層級 | 元件 | 職責 |
|------|------|------|
| 客戶端 | 瀏覽器 | 渲染 ASP 輸出的 HTML/CSS/JS |
| Web 層 | IIS + ASP | 請求處理、VBScript 業務邏輯、frameset 框架頁 |
| 公共元件層 | `public/` 目錄 | 資料庫連線、加密、日誌、郵件、上傳、權限檢查 |
| 業務模組層 | HM/mo/batch/clearance/finance/EISMII/SMS | 各業務功能實現 |
| 資料庫層 | SQL Server (主) + MySQL (輔) | 資料持久化 |
| 外部系統 | ERP / SMTP / 簡訊閘道 | 資料同步與通知 |

---

## 二、技術堆疊

| 層級 | 技術 / 元件 | 說明 |
|------|-------------|------|
| 前端 | Classic ASP (VBScript)、HTML、CSS、JavaScript | CodePage=936 (GB2312 簡體中文) |
| UI 框架 | BootStrap 3.4.1 | 響應式樣式 |
| 圖表 | ichartjs | 質量/效率圖表 |
| Web 伺服器 | IIS + `web.config` | frameset 多框架頁結構 |
| 主資料庫 | Microsoft SQL Server | 多庫別切換，由 `conn.txt` 決定 |
| 輔助資料庫 | MySQL (ODBC 8.0) | `talent_db` |
| 加密 | 自製 `encrypt.asp` / `Crypt.asp` + `KeyGeN.asp` | 密碼加密、授權碼驗證 |
| 郵件 | JMail 元件 | `send_email.asp` 透過 SMTP 發送通知 |
| 檔案處理 | ADODB.Stream + FileSystemObject | Excel/BOM/PO 上傳匯入 |
| 字元編碼 | GB2312 ↔ Big5 轉換 | `gb2312tobig5.asp` 兩岸相容 |

---

## 三、登入與權限流程

```mermaid
sequenceDiagram
    participant U as 使用者
    participant L as login.asp
    participant C as check.asp
    participant DB as SQL Server
    participant S as Session

    U->>L: 輸入 帳號/密碼/資料庫別
    L->>L: 前端驗證(密碼8位數字)
    L->>C: 提交 check.asp
    C->>DB: 讀 conn.txt 取 DB 名稱
    C->>DB: 連線 conn.Open
    C->>DB: 查 cams_system_codes<br/>(setup 授權碼+到期日)
    C->>C: 驗證授權未過期/未被竄改
    C->>DB: 查 cams_xuser 比對加密密碼
    C->>DB: 查 leader_user 取權限
    C->>S: 寫入 13 項權限 Session
    C->>DB: 寫 login_user_record (登入記錄)
    C->>U: 跳轉 main.asp
```

### 驗證流程說明

1. **前端正規檢查** (`login.asp`)：密碼必須 8 位純數字；帳號密碼禁止 `' % < > & |` 等特殊字元。
2. **授權碼驗證** (`check.asp`)：查詢 `cams_system_codes` 中 `code_type='setup'`：
   - `value_date1` / `value_alpha1`：初始使用授權碼 + 加密校驗
   - `value_date2` / `value_alpha2`：終止使用授權碼 + 加密校驗
   - 任何授權碼被竄改 → 立即中止登入
3. **密碼比對**：`encrypt(password) <> cams_xuser.xuser_password`
4. **首次密碼強制變更**：密碼為 `12345678` 時跳轉 `modify_password.asp`。
5. **權限載入**：從 `leader_user` 表讀取 13 項功能權限寫入 Session。

### 權限模組（Session 變數）

| Session 變數 | 業務功能 | 說明 |
|--------------|----------|------|
| `procurement` | 採購 | 採購單、供應商 |
| `sales` | 業務 | 客戶訂單、報價 |
| `production` | 生產 | 製造訂單、生產日報 |
| `engineer` | 工程 | BOM、工序、模具 |
| `handbook` | 手冊 | 海關手冊 |
| `wk_plan` | 生管 | 生產排程 |
| `quality` | 品質 | QRQC、IQC/OQC |
| `document` | 文件 | 文件管理 |
| `price` | 價格 | 產品報價 |
| `stock` | 倉庫 | 物料進出、庫存 |
| `finance` | 財務 | AR/AP、付款 |
| `imex` | 進出口 | 報關、進出口 |
| `others` | 其他 | 其他功能 |
| `class` | 管理等級 | 決定管理者身份 |

---

## 四、資料庫架構與多租戶切換

```mermaid
flowchart LR
    CONNTXT["conn.txt<br/>資料庫清單"] --> CONN["conn.asp"]
    CONN --> |session DB 決定| SELECT{"選擇資料庫"}
    SELECT --> ERMM_HM["ERMM_HM 鉑漢"]
    SELECT --> ERMM_LD["ERMM_LD 利騰"]
    SELECT --> ERMM_MQ["ERMM_MQ"]
    SELECT --> ERMM_JS["ERMM_JS"]
    SELECT --> ERMM_VENTEC["ERMM_Ventec"]
    SELECT --> ERMM_GY["ERMM_GY"]
    SELECT --> ERMM_ICHIA["ERMM_Ichia_2nd"]

    ERMM_HM --> TABLES["共用資料表群"]
    TABLES --> CAMS["cams_* 系統碼表"]
    TABLES --> LEADER["leader_user 權限"]
    TABLES --> LOGIN_REC["login_user_record 日誌"]
    TABLES --> XUSER["cams_xuser 使用者"]
    TABLES --> XWEBPAGE["cams_xwebpage 頁面選單"]
    TABLES --> XBATCH["cams_batch_control 批次"]
    TABLES --> E2["e2_notes_management 待辦"]
```

### 多租戶設計

- 同一套程式碼，登入時選擇不同資料庫別（對應不同公司/廠區）
- `conn.txt` 列出 9 個資料庫別，實現「一套程式多公司部署」
- 各資料庫結構相同，資料獨立隔離

### 主要資料表群

| 資料表前綴/名稱 | 用途 |
|-----------------|------|
| `cams_xuser` | 使用者帳號、密碼(加密)、姓名、部門、客戶別 |
| `cams_xuser_xbu` | 使用者與業務單位(BU)關聯 |
| `cams_xusers_webpage` | 使用者與頁面授權關聯 |
| `cams_xwebpage` | 系統頁面註冊表(seq_system 編碼、URL、發布旗標) |
| `cams_system_codes` | 系統授權碼、郵件清單、批次控制 |
| `cams_global_codes` | 全域代碼(client_id、截止日期、批次控制) |
| `cams_batch_control` | 批次作業記錄(batch_id) |
| `leader_user` | 權限管理(12 項功能權限 + 管理旗標) |
| `login_user_record` | 登入日誌(登入/登出/使用次數/頁面記錄) |
| `e2_notes_management` | 品質異常待辦追蹤 |
| `MGM_QC_wkteam_details` | 品質小組任務分派 |

---

## 五、核心業務模組關係

```mermaid
flowchart TB
    subgraph 營業["業務接單 Order-to-Cash"]
        SO["客戶訂單<br/>STD_order_add"]
        PRICE["產品報價<br/>價格模組"]
    end

    subgraph 採購["採購 Procure-to-Pay"]
        PO["採購單 PO<br/>STD_po_print/STD_upload_PO"]
        SUP["供應商管理"]
        IQC["進料檢驗 IQC<br/>LP_QC_menu_IQC"]
    end

    subgraph 生產["生產製造"]
        BOM["BOM 物料清單<br/>STD_bom_*"]
        MO["製造訂單 MO<br/>mo/1100, 1300"]
        STD_CAP["標準產能<br/>工序"]
        PLAN["生產排程<br/>生管 wk_plan"]
        OQC["出貨檢驗 OQC<br/>LP_QC_menu_OQC"]
        PSI["PSI 檢驗"]
    end

    subgraph 品質["品質管理 QRQC"]
        QRQC["QRQC 快速回應<br/>STD_QRQC_*"]
        CAR["CAR 矯正措施"]
        DEFECT["缺陷追蹤<br/>e2_notes_management"]
    end

    subgraph 倉庫["倉庫/物控"]
        STOCK["物料進出<br/>庫存平衡"]
        MATERIAL["物料批次"]
    end

    subgraph 報關["海關報關"]
        CUSTOM["報關單<br/>clearance/8000,8100"]
        HANDBOOK["海關手冊<br/>handbook"]
        IMEX["進出口 imex"]
    end

    subgraph 財務["財務管理"]
        ARAP["應收應付 AR/AP"]
        PAY["付款 pay_list"]
        CHECK_F["票據 check_*"]
        FIN_RPT["財務報表分析"]
    end

    SO --> BOM
    SO --> MO
    BOM --> MO
    PO --> SUP
    SUP --> IQC
    IQC --> STOCK
    MO --> PLAN
    MO --> QRQC
    PLAN --> OQC
    OQC --> PSI
    QRQC --> CAR
    QRQC --> DEFECT
    MO --> STOCK
    STOCK --> CUSTOM
    CUSTOM --> IMEX
    SO --> ARAP
    PO --> ARAP
    ARAP --> PAY
    ARAP --> CHECK_F
    ARAP --> FIN_RPT
```

### 業務流程說明

#### 1. 接單到收款 (Order-to-Cash)
客戶訂單 → BOM 展開 → 製令生產 → 出貨檢驗 → 應收帳款 → 收款/票據 → 財務分析

#### 2. 採購到付款 (Procure-to-Pay)
採購單 PO → 供應商管理 → 進料檢驗 IQC → 入庫 → 應付帳款 → 付款 → 票據管理

#### 3. 生產製造流程
BOM 物料清單 → 製造訂單 MO → 標準產能/工序 → 生產排程 → 生產日報 → 出貨檢驗 OQC/PSI

#### 4. 品質閉環
QRQC 快速回應 → CAR 矯正措施 → e2_notes_management 待辦追蹤 → header_message.asp 跑馬燈提醒 → 結案

#### 5. 報關與進出口
物料進出 → 海關手冊 → 報關單 → 進出口管理 → 財務入帳

---

## 六、ERP 整合與批次作業流程

```mermaid
sequenceDiagram
    participant ERP as 外部 ERP
    participant B as batch/ 批次
    participant DB as SQL Server
    participant M as mo/ 製令模組
    participant E as EISMII/ 庫存
    participant MAIL as 郵件通知

    ERP->>B: erp2eism_mo.asp<br/>同步製造訂單(MO)
    ERP->>B: erp2ermm_po.asp<br/>同步採購訂單(PO)
    B->>B: proc_po.asp 處理PO
    B->>B: proc_mo_online.asp 處理MO
    B->>B: proc_supplier.asp 供應商
    B->>B: proc_bom_convert.asp BOM轉換
    B->>B: cal_daily_xitems_stock_balance.asp<br/>每日庫存結算
    B->>B: cal_mo_category.asp 訂單分類
    B->>B: proc_xitems_link_lawbook.asp<br/>物料綁定海關法規
    B->>DB: 寫入對應資料表
    B->>MAIL: send_email.asp<br/>異常通知
    Note over B: start_batch.asp 啟動<br/>end_batch.asp 結束<br/>batch_id 全程追蹤
```

### 批次作業模組 (batch/ 目錄)

| 檔案 | 功能 |
|------|------|
| `start_batch.asp` | 批次啟動，產生 batch_id |
| `end_batch.asp` | 批次結束 |
| `erp2eism_mo.asp` | 從 ERP 同步製造訂單 (MO) |
| `erp2ermm_po.asp` | 從 ERP 同步採購訂單 (PO) |
| `proc_po.asp` | 採購單處理 |
| `proc_mo_online.asp` | 線上製令處理 |
| `proc_supplier.asp` | 供應商資料處理 |
| `proc_bom_convert.asp` | BOM 產品結構轉換 |
| `cal_daily_xitems_stock_balance.asp` | 每日物料庫存平衡計算 |
| `cal_mo_category.asp` | 製令分類計算 |
| `proc_xitems_link_lawbook.asp` | 物料綁定海關法規 |
| `send_email.asp` | 批次異常郵件通知 |

### 批次控制機制

- `cams_batch_control` 記錄 batch_id 全程追蹤
- `cams_global_codes` 中關鍵截止代碼：
  - `BATCH_CONTROL`：批次控制日期
  - `CUSTOM_CUTOFF`：報關截止日
  - `MO_CUTOFF`：製令截止日
  - `INV_CUTOFF`：庫存截止日

---

## 七、頁面編碼體系

系統所有功能頁面由 `cams_xwebpage` 資料表統一註冊，以 `seq_system` 跨號分類：

| 跨號區段 | 業務領域 | 對應 document/ PDF |
|----------|----------|-------------------|
| 1000 系列 | 系統設定/首頁 | 1000~1050.pdf |
| 2000 系列 | 業務接單/報價 | 2000~2130.pdf |
| 3000 系列 | 採購/物料 | 3000~3072.pdf |
| 5000 系列 | 生產製造/庫存 | 5000~5030.pdf |
| 8000 系列 | 海關報關/進出口 | 8000~8070.pdf |
| 8500 系列 | 財務管理 | 8500~8530.pdf |

### 動態選單機制 (left_new.asp)

```mermaid
flowchart LR
    USER["使用者登入"] --> CHECK_ID{"管理者?"}
    CHECK_ID -->|george/rocky.tai| ALL["顯示所有頁面<br/>seq_system not like 99%"]
    CHECK_ID -->|一般使用者| AUTH["查 cams_xusers_webpage<br/>只顯示授權頁面"]
    ALL --> RENDER["分頁渲染<br/>18 頁/頁"]
    AUTH --> RENDER
    RENDER --> FLAG{"release_flag?"}
    FLAG -->|NO| GRAY["灰色樣式 color"]
    FLAG -->|YES| NORMAL["正常樣式"]
```

- 管理者：顯示所有 `seq_system not like '99%'` 且 `test_only='F'` 頁面
- 一般使用者：透過 `cams_xusers_webpage` 關聯表只顯示授權頁面
- `release_flag=NO` 標記未正式發布頁面（灰色顯示）
- 分頁顯示，每頁 18 個功能按鈕

---

## 八、日誌與稽核機制

```mermaid
flowchart LR
    LOGIN["登入 check.asp"] -->|insert| LUR["login_user_record<br/>登入/登出/使用次數"]
    BROWSE["瀏覽頁面 conn.asp"] -->|update use_cnt| LUR
    BROWSE -->|update xwebpage_id| LUR
    EXIT["登出 exit.asp"] -->|update logoff_time| LUR
    OP["操作"] --> START["start_log.asp<br/>記錄開始"]
    OP --> END_LOG["end_log.asp<br/>記錄結束"]
    LEADER["leader_user"] -->|login=Y/N| ONLINE["線上人員追蹤<br/>header_message.asp 跑馬燈"]
    BATCH["批次作業"] --> BC["cams_batch_control<br/>batch_id 追蹤"]
```

### 稽核機制說明

1. **登入日誌** (`login_user_record`)：記錄每次登入時間、使用次數、當前瀏覽頁面、登出時間
2. **線上人員追蹤**：`leader_user.login='Y'` 標記線上狀態，`header_message.asp` 跑馬燈顯示線上人員清單
3. **自動登出**：跨日登入狀態自動清除（`header_message.asp` 檢查 `diff_time > 0`）
4. **操作記錄**：`start_log.asp` / `end_log.asp` 記錄各操作開始與結束時間
5. **批次追蹤**：`cams_batch_control` 的 batch_id 貫穿整個批次作業流程

---

## 九、整體關係總結

```mermaid
mindmap
  root((ERMM 系統))
    技術架構
      Classic ASP + VBScript
      IIS Web Server
      SQL Server 多租戶
      MySQL 輔助
      GB2312 中文編碼
    認證授權
      帳號密碼加密
      授權碼到期驗證
      13 項功能權限
      頁面級授權
    業務價值鏈
      接單 Order-to-Cash
      採購 Procure-to-Pay
      生產製造
      品質閉環 QRQC
      倉儲物控
      海關報關
      財務管理
    整合能力
      ERP 雙向同步
      批次作業 batch_id
      JMail 郵件通知
      簡訊驗證 SMS
    稽核追蹤
      登入日誌
      線上人員追蹤
      操作記錄
      批次追蹤
```

### 七大核心特徵

1. **單一入口框架**：`login.asp → check.asp → main.asp(frameset)` 統一入口，頂部 `index.asp` 顯示公司/時間/登出，左側 `left_new.asp` 動態選單，主內容 `body.asp` iframe。

2. **權限雙層控制**：`cams_xuser`(帳號密碼) + `leader_user`(13 項功能權限) + `cams_xusers_webpage`(頁面級授權)，形成三層權限體系。

3. **多租戶架構**：一套程式碼，登入時選 DB 切換公司，`conn.txt` 列出 9 個資料庫別（鉑漢/利騰/Ventec/Ichia 等），各廠區資料獨立隔離。

4. **ERP 雙向整合**：`batch/` 目錄從 ERP 同步 PO/MO/BOM/供應商，並計算庫存平衡、訂單分類、物料報關法規綁定，以 `batch_id` 全程追蹤。

5. **品質閉環**：QRQC 快速回應 → CAR 矯正 → `e2_notes_management` 待辦追蹤 → `header_message.asp` 跑馬燈提醒，形成品質異常追蹤閉環。

6. **報關財務一體**：物料進出 → 海關手冊/報關單 → 應收應付(AR/AP) → 付款/票據 → 財務分析，整合進出口(imex)與財務(finance)模組。

7. **稽核完整**：`login_user_record` 記錄每次登入/使用/登出，`cams_batch_control` 追蹤批次作業，`start_log/end_log` 記錄操作歷程，`leader_user` 追蹤線上人員。

---

## 附錄：關鍵檔案索引

| 檔案路徑 | 功能 |
|----------|------|
| `login.asp` | 登入頁 |
| `check.asp` | 登入驗證 + 授權碼檢查 + 權限載入 |
| `main.asp` | frameset 主框架 (頂部+左側+主內容) |
| `index.asp` | 頂部 header (公司/時間/登出) |
| `left_new.asp` | 左側動態選單 (依權限渲染) |
| `body.asp` | 主內容 iframe 容器 |
| `exit.asp` | 登出 (清除 login 狀態 + 記錄 logoff) |
| `public/conn.asp` | 主資料庫連線 (依 session DB) |
| `public/encrypt.asp` | 密碼加密函式 |
| `public/send_email.asp` | JMail 郵件發送 |
| `public/start_log.asp` | 操作開始日誌 |
| `public/end_log.asp` | 操作結束日誌 |
| `public/upload.asp` | 檔案上傳 |
| `conn.txt` | 資料庫別清單 (9 個) |
| `web.config` | IIS 設定 |
| `setup/setup.asp` | 系統初始化設定 |
| `HM/` | 主管理 + 品質控制模組 |
| `mo/` | 製造訂單模組 (1100/1300 系列) |
| `batch/` | 批次作業 + ERP 整合 |
| `clearance/` | 海關報關模組 (8000/8100) |
| `finance/` | 財務管理模組 |
| `EISMII/` | EIS 庫存管理模組 |
| `SMS/` | 簡訊驗證模組 |

---

*文件版本：1.0  
生成日期：2026-09-02  
系統：ERMM (Enterprise Resource Management & Manufacturing)*
