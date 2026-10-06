//! Ã–ÄŸe embedding'leri arasÄ± benzerlik gruplaÅŸmasÄ± (defter tekrar tespiti).
//! EÅŸik Ã¼stÃ¼ Ã§iftleri union-find ile baÄŸlÄ± bileÅŸenlere indirger; komuta katmanÄ±
//! TS tarafÄ±nda kategorize/birleÅŸtir akÄ±ÅŸÄ±nÄ± yÃ¶nlendirir.

/// KosinÃ¼s benzerliÄŸi. BoÅŸ ve boyut uyuÅŸmayan girdide 0 (NaN yayÄ±lmaz).
pub(crate) fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let den = na.sqrt() * nb.sqrt();
    if den == 0.0 {
        0.0
    } else {
        dot / den
    }
}

struct Dsu {
    parent: Vec<usize>,
}

impl Dsu {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
        }
    }

    fn find(&mut self, x: usize) -> usize {
        let mut root = x;
        while self.parent[root] != root {
            root = self.parent[root];
        }
        // Path compression.
        let mut cur = x;
        while self.parent[cur] != root {
            let next = self.parent[cur];
            self.parent[cur] = root;
            cur = next;
        }
        root
    }

    fn union(&mut self, a: usize, b: usize) {
        let ra = self.find(a);
        let rb = self.find(b);
        if ra != rb {
            // KÃ¶k indeksi kÃ¼Ã§Ã¼k olan kazanÄ±r: grup sÄ±ralamasÄ± determinizmin.
            if ra < rb {
                self.parent[rb] = ra;
            } else {
                self.parent[ra] = rb;
            }
        }
    }
}

/// EÅŸik Ã¼stÃ¼ baÄŸlÄ± bileÅŸenler (senkron Ã§ekirdek): yalnÄ±z >=2 Ã¼yeli gruplar;
/// gruplar iÃ§inde ve gruplar arasÄ±nda indeks sÄ±ralÄ±.
fn group_by_threshold(vectors: &[Vec<f32>], threshold: f32) -> Vec<Vec<usize>> {
    let n = vectors.len();
    let mut dsu = Dsu::new(n);
    for i in 0..n {
        for j in (i + 1)..n {
            if cosine(&vectors[i], &vectors[j]) >= threshold {
                dsu.union(i, j);
            }
        }
    }
    let mut buckets: std::collections::HashMap<usize, Vec<usize>> =
        std::collections::HashMap::new();
    for i in 0..n {
        buckets.entry(dsu.find(i)).or_default().push(i);
    }
    let mut groups: Vec<Vec<usize>> = buckets
        .into_values()
        .filter(|members| members.len() >= 2)
        .map(|mut members| {
            members.sort_unstable();
            members
        })
        .collect();
    groups.sort_unstable();
    groups
}

/// EÅŸik Ã¼stÃ¼ baÄŸlÄ± bileÅŸenleri dÃ¶ndÃ¼rÃ¼r: yalnÄ±z >=2 Ã¼yeli gruplar; gruplar
/// iÃ§inde ve gruplar arasÄ±nda indeks sÄ±ralÄ±.
#[tauri::command]
pub async fn dedupe_candidates(
    vectors: Vec<Vec<f32>>,
    threshold: f32,
) -> Result<Vec<Vec<usize>>, String> {
    Ok(group_by_threshold(&vectors, threshold))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_paralel_bir() {
        assert!((cosine(&[1.0, 1.0], &[2.0, 2.0]) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_dikey_sifir() {
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
    }

    #[test]
    fn cosine_sifir_vektor_nan_degil() {
        assert!(cosine(&[0.0, 0.0], &[1.0, 2.0]) == 0.0);
        assert!(cosine(&[], &[]) == 0.0);
    }

    #[test]
    fn esik_ustu_cift_birlesir() {
        let groups = group_by_threshold(
            &vec![vec![1.0, 0.0], vec![1.0, 0.0], vec![0.0, 1.0]],
            0.9,
        );
        assert_eq!(groups, vec![vec![0, 1]]);
    }

    #[test]
    fn gecisli_zincir_tek_grup() {
        // 0-25-50 derecelik birim vektorler: a~b (0.906), b~c (0.906), ama
        // a-c (0.643) esik alti — connected component transitivity testi.
        let groups = group_by_threshold(
            &vec![
                vec![1.0, 0.0],
                vec![0.9063, 0.4226],
                vec![0.6428, 0.7660],
            ],
            0.9,
        );
        assert_eq!(groups, vec![vec![0, 1, 2]]);
    }

    #[test]
    fn esik_alti_ayri() {
        let groups =
            group_by_threshold(&vec![vec![1.0, 0.0], vec![0.0, 1.0]], 0.9);
        assert!(groups.is_empty());
    }
}
