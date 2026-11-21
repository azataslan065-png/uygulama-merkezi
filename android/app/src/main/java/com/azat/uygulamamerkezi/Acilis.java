package com.azat.uygulamamerkezi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/* Telefon açılınca ya da mağaza güncellenince güncelleme denetimini yeniden planlar. */
public class Acilis extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) { if (BuildConfig.MAGAZA) Denetci.planla(c); }
}
