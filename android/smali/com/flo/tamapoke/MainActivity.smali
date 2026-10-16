.class public Lcom/flo/tamapoke/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"

# Activité unique : une WebView plein écran qui charge assets/www/index.html.
#
#   onCreate      : réglages WebView + pont JS "TPStore" (SharedPreferences)
#   onPause       : tpPause()  -> le jeu note l'heure et sauvegarde
#   onResume      : tpResume() -> applique le temps passé appli fermée
#   onBackPressed : tpBack()   -> ferme l'écran en cours, sinon arrière-plan

.field private web:Landroid/webkit/WebView;
.field private bridge:Lcom/flo/tamapoke/Bridge;


.method public constructor <init>()V
    .registers 1
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V
    return-void
.end method


.method protected onCreate(Landroid/os/Bundle;)V
    .registers 6

    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    # barres système à la couleur du fond
    invoke-virtual {p0}, Landroid/app/Activity;->getWindow()Landroid/view/Window;
    move-result-object v0
    const v1, -0xefede8
    invoke-virtual {v0, v1}, Landroid/view/Window;->setStatusBarColor(I)V
    invoke-virtual {v0, v1}, Landroid/view/Window;->setNavigationBarColor(I)V

    new-instance v0, Landroid/webkit/WebView;
    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V
    iput-object v0, p0, Lcom/flo/tamapoke/MainActivity;->web:Landroid/webkit/WebView;
    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;
    move-result-object v2
    const/4 v3, 0x1
    invoke-virtual {v2, v3}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V
    invoke-virtual {v2, v3}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V
    invoke-virtual {v2, v3}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V
    invoke-virtual {v2, v3}, Landroid/webkit/WebSettings;->setAllowFileAccessFromFileURLs(Z)V
    const/4 v3, 0x0
    invoke-virtual {v2, v3}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V
    const/16 v3, 0x64
    invoke-virtual {v2, v3}, Landroid/webkit/WebSettings;->setTextZoom(I)V

    new-instance v2, Lcom/flo/tamapoke/Bridge;
    invoke-direct {v2, p0}, Lcom/flo/tamapoke/Bridge;-><init>(Landroid/app/Activity;)V
    iput-object v2, p0, Lcom/flo/tamapoke/MainActivity;->bridge:Lcom/flo/tamapoke/Bridge;
    const-string v3, "TPStore"
    invoke-virtual {v0, v2, v3}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    invoke-virtual {p0, v0}, Landroid/app/Activity;->setContentView(Landroid/view/View;)V

    const-string v2, "file:///android_asset/www/index.html"
    invoke-virtual {v0, v2}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V
    return-void
.end method


.method private js(Ljava/lang/String;)V
    .registers 4
    iget-object v0, p0, Lcom/flo/tamapoke/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v0, :done
    const/4 v1, 0x0
    invoke-virtual {v0, p1, v1}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V
    :done
    return-void
.end method


.method protected onPause()V
    .registers 3
    const-string v0, "window.tpPause&&tpPause()"
    invoke-direct {p0, v0}, Lcom/flo/tamapoke/MainActivity;->js(Ljava/lang/String;)V
    iget-object v0, p0, Lcom/flo/tamapoke/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v0, :skip
    invoke-virtual {v0}, Landroid/webkit/WebView;->onPause()V
    :skip
    iget-object v0, p0, Lcom/flo/tamapoke/MainActivity;->bridge:Lcom/flo/tamapoke/Bridge;
    if-eqz v0, :nob
    invoke-virtual {v0}, Lcom/flo/tamapoke/Bridge;->stop()V
    :nob
    invoke-super {p0}, Landroid/app/Activity;->onPause()V
    return-void
.end method


.method protected onResume()V
    .registers 3
    invoke-super {p0}, Landroid/app/Activity;->onResume()V
    iget-object v0, p0, Lcom/flo/tamapoke/MainActivity;->bridge:Lcom/flo/tamapoke/Bridge;
    if-eqz v0, :nob
    invoke-virtual {v0}, Lcom/flo/tamapoke/Bridge;->start()V
    :nob
    iget-object v0, p0, Lcom/flo/tamapoke/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v0, :skip
    invoke-virtual {v0}, Landroid/webkit/WebView;->onResume()V
    :skip
    const-string v0, "window.tpResume&&tpResume()"
    invoke-direct {p0, v0}, Lcom/flo/tamapoke/MainActivity;->js(Ljava/lang/String;)V
    return-void
.end method


.method public onBackPressed()V
    .registers 2
    const-string v0, "window.tpBack?tpBack():TPStore.moveToBack()"
    invoke-direct {p0, v0}, Lcom/flo/tamapoke/MainActivity;->js(Ljava/lang/String;)V
    return-void
.end method


.method protected onDestroy()V
    .registers 2
    iget-object v0, p0, Lcom/flo/tamapoke/MainActivity;->web:Landroid/webkit/WebView;
    if-eqz v0, :skip
    invoke-virtual {v0}, Landroid/webkit/WebView;->destroy()V
    :skip
    invoke-super {p0}, Landroid/app/Activity;->onDestroy()V
    return-void
.end method
