.class public Lcom/flo/tamapoke/Bridge;
.super Ljava/lang/Object;
.source "Bridge.java"

.implements Landroid/hardware/SensorEventListener;
.implements Ljava/lang/Runnable;

# Pont exposé à la page sous le nom window.TPStore :
#   getItem(k) / setItem(k, v) : sauvegarde dans SharedPreferences "tamapoke"
#   readAsset(chemin)          : fichier des assets en base64 (secours si XHR file:// échoue)
#   moveToBack()               : passe l'appli en arrière-plan (bouton retour)
#   stepState()                : 1 podomètre actif, 0 permission à accorder, -1 pas de capteur
#   getSteps()                 : compteur matériel cumulé depuis le démarrage (-1 si pas encore lu)
#   askStepPermission()        : demande ACTIVITY_RECOGNITION (Android 10+)
#
# Le compteur TYPE_STEP_COUNTER compte en permanence, même appli fermée : on
# n'écoute que pendant que l'appli est ouverte (start/stop), la page fait la
# différence avec la dernière valeur lue.

.field private final act:Landroid/app/Activity;
.field private final prefs:Landroid/content/SharedPreferences;
.field private sm:Landroid/hardware/SensorManager;
.field private sensor:Landroid/hardware/Sensor;
.field private registered:Z
.field private volatile steps:F
.field private volatile state:I


.method public constructor <init>(Landroid/app/Activity;)V
    .registers 4
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    iput-object p1, p0, Lcom/flo/tamapoke/Bridge;->act:Landroid/app/Activity;
    const-string v0, "tamapoke"
    const/4 v1, 0x0
    invoke-virtual {p1, v0, v1}, Landroid/app/Activity;->getSharedPreferences(Ljava/lang/String;I)Landroid/content/SharedPreferences;
    move-result-object v0
    iput-object v0, p0, Lcom/flo/tamapoke/Bridge;->prefs:Landroid/content/SharedPreferences;

    const/high16 v0, -0x40800000    # -1.0f
    iput v0, p0, Lcom/flo/tamapoke/Bridge;->steps:F
    const/4 v0, -0x1
    iput v0, p0, Lcom/flo/tamapoke/Bridge;->state:I

    const-string v0, "sensor"
    invoke-virtual {p1, v0}, Landroid/app/Activity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;
    move-result-object v0
    check-cast v0, Landroid/hardware/SensorManager;
    iput-object v0, p0, Lcom/flo/tamapoke/Bridge;->sm:Landroid/hardware/SensorManager;
    if-eqz v0, :done
    const/16 v1, 0x13              # Sensor.TYPE_STEP_COUNTER
    invoke-virtual {v0, v1}, Landroid/hardware/SensorManager;->getDefaultSensor(I)Landroid/hardware/Sensor;
    move-result-object v0
    iput-object v0, p0, Lcom/flo/tamapoke/Bridge;->sensor:Landroid/hardware/Sensor;
    :done
    return-void
.end method


# appelé par onResume : vérifie la permission puis écoute le capteur
.method public start()V
    .registers 5
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->sensor:Landroid/hardware/Sensor;
    if-nez v0, :has
    const/4 v1, -0x1
    iput v1, p0, Lcom/flo/tamapoke/Bridge;->state:I
    return-void

    :has
    sget v1, Landroid/os/Build$VERSION;->SDK_INT:I
    const/16 v2, 0x1d
    if-lt v1, v2, :granted
    iget-object v1, p0, Lcom/flo/tamapoke/Bridge;->act:Landroid/app/Activity;
    const-string v2, "android.permission.ACTIVITY_RECOGNITION"
    invoke-virtual {v1, v2}, Landroid/app/Activity;->checkSelfPermission(Ljava/lang/String;)I
    move-result v1
    if-eqz v1, :granted
    const/4 v1, 0x0
    iput v1, p0, Lcom/flo/tamapoke/Bridge;->state:I
    return-void

    :granted
    iget-boolean v1, p0, Lcom/flo/tamapoke/Bridge;->registered:Z
    if-nez v1, :ok
    iget-object v1, p0, Lcom/flo/tamapoke/Bridge;->sm:Landroid/hardware/SensorManager;
    const/4 v2, 0x3                # SENSOR_DELAY_NORMAL
    invoke-virtual {v1, p0, v0, v2}, Landroid/hardware/SensorManager;->registerListener(Landroid/hardware/SensorEventListener;Landroid/hardware/Sensor;I)Z
    move-result v1
    iput-boolean v1, p0, Lcom/flo/tamapoke/Bridge;->registered:Z
    if-nez v1, :ok
    const/4 v1, -0x1
    iput v1, p0, Lcom/flo/tamapoke/Bridge;->state:I
    return-void

    :ok
    const/4 v1, 0x1
    iput v1, p0, Lcom/flo/tamapoke/Bridge;->state:I
    return-void
.end method


# appelé par onPause
.method public stop()V
    .registers 3
    iget-boolean v0, p0, Lcom/flo/tamapoke/Bridge;->registered:Z
    if-eqz v0, :done
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->sm:Landroid/hardware/SensorManager;
    invoke-virtual {v0, p0}, Landroid/hardware/SensorManager;->unregisterListener(Landroid/hardware/SensorEventListener;)V
    const/4 v0, 0x0
    iput-boolean v0, p0, Lcom/flo/tamapoke/Bridge;->registered:Z
    :done
    return-void
.end method


.method public onSensorChanged(Landroid/hardware/SensorEvent;)V
    .registers 4
    iget-object v0, p1, Landroid/hardware/SensorEvent;->values:[F
    if-eqz v0, :done
    array-length v1, v0
    if-eqz v1, :done
    const/4 v1, 0x0
    aget v0, v0, v1
    iput v0, p0, Lcom/flo/tamapoke/Bridge;->steps:F
    :done
    return-void
.end method


.method public onAccuracyChanged(Landroid/hardware/Sensor;I)V
    .registers 3
    return-void
.end method


# Runnable : la demande de permission part du thread principal
.method public run()V
    .registers 5
    sget v0, Landroid/os/Build$VERSION;->SDK_INT:I
    const/16 v1, 0x1d
    if-lt v0, v1, :done
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->act:Landroid/app/Activity;
    const/4 v1, 0x1
    new-array v1, v1, [Ljava/lang/String;
    const/4 v2, 0x0
    const-string v3, "android.permission.ACTIVITY_RECOGNITION"
    aput-object v3, v1, v2
    const/16 v2, 0x2a
    invoke-virtual {v0, v1, v2}, Landroid/app/Activity;->requestPermissions([Ljava/lang/String;I)V
    :done
    return-void
.end method


.method public stepState()I
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget v0, p0, Lcom/flo/tamapoke/Bridge;->state:I
    return v0
.end method


.method public getSteps()F
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget v0, p0, Lcom/flo/tamapoke/Bridge;->steps:F
    return v0
.end method


.method public askStepPermission()V
    .registers 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->act:Landroid/app/Activity;
    invoke-virtual {v0, p0}, Landroid/app/Activity;->runOnUiThread(Ljava/lang/Runnable;)V
    return-void
.end method


.method public getItem(Ljava/lang/String;)Ljava/lang/String;
    .registers 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->prefs:Landroid/content/SharedPreferences;
    const/4 v1, 0x0
    invoke-interface {v0, p1, v1}, Landroid/content/SharedPreferences;->getString(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;
    move-result-object v0
    return-object v0
.end method


.method public setItem(Ljava/lang/String;Ljava/lang/String;)V
    .registers 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->prefs:Landroid/content/SharedPreferences;
    invoke-interface {v0}, Landroid/content/SharedPreferences;->edit()Landroid/content/SharedPreferences$Editor;
    move-result-object v0
    invoke-interface {v0, p1, p2}, Landroid/content/SharedPreferences$Editor;->putString(Ljava/lang/String;Ljava/lang/String;)Landroid/content/SharedPreferences$Editor;
    move-result-object v0
    invoke-interface {v0}, Landroid/content/SharedPreferences$Editor;->apply()V
    return-void
.end method


.method public readAsset(Ljava/lang/String;)Ljava/lang/String;
    .registers 7
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    :try_start_0
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->act:Landroid/app/Activity;
    invoke-virtual {v0}, Landroid/app/Activity;->getAssets()Landroid/content/res/AssetManager;
    move-result-object v0
    invoke-virtual {v0, p1}, Landroid/content/res/AssetManager;->open(Ljava/lang/String;)Ljava/io/InputStream;
    move-result-object v0
    new-instance v1, Ljava/io/ByteArrayOutputStream;
    invoke-direct {v1}, Ljava/io/ByteArrayOutputStream;-><init>()V
    const/16 v2, 0x4000
    new-array v2, v2, [B
    :loop
    invoke-virtual {v0, v2}, Ljava/io/InputStream;->read([B)I
    move-result v3
    if-ltz v3, :done
    const/4 v4, 0x0
    invoke-virtual {v1, v2, v4, v3}, Ljava/io/ByteArrayOutputStream;->write([BII)V
    goto :loop
    :done
    invoke-virtual {v0}, Ljava/io/InputStream;->close()V
    invoke-virtual {v1}, Ljava/io/ByteArrayOutputStream;->toByteArray()[B
    move-result-object v2
    const/4 v4, 0x2
    invoke-static {v2, v4}, Landroid/util/Base64;->encodeToString([BI)Ljava/lang/String;
    move-result-object v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0
    return-object v0

    :catch_0
    const/4 v0, 0x0
    return-object v0
.end method


.method public moveToBack()V
    .registers 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation
    iget-object v0, p0, Lcom/flo/tamapoke/Bridge;->act:Landroid/app/Activity;
    const/4 v1, 0x1
    invoke-virtual {v0, v1}, Landroid/app/Activity;->moveTaskToBack(Z)Z
    return-void
.end method
